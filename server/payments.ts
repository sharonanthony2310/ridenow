
import Stripe from "stripe";
import express, {
  type Express,
  type Request,
  type Response,
} from "express";
import { getAuth } from "@clerk/express";
import { supabase } from "./supabase";

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:3000";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

function getUserId(req: Request): string | null {
  const auth = getAuth(req);
  return auth.isAuthenticated ? auth.userId : null;
}

function isValidRideId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function getStripeClient(res: Response): Stripe | null {
  if (!stripe) {
    res.status(503).json({
      error: "Stripe is not configured. Check STRIPE_SECRET_KEY.",
    });
    return null;
  }

  return stripe;
}

function getPaymentIntentId(
  paymentIntent: string | Stripe.PaymentIntent | null
): string | null {
  if (typeof paymentIntent === "string") {
    return paymentIntent;
  }

  if (paymentIntent && typeof paymentIntent === "object") {
    return paymentIntent.id;
  }

  return null;
}

/**
 * Update the payment using the exact Stripe Checkout Session ID.
 * If the row cannot be found by session ID, use the ride/passenger
 * metadata as a fallback, but never overwrite another session.
 */
async function markPayment(
  session: Stripe.Checkout.Session,
  status: "paid" | "failed" | "cancelled"
): Promise<boolean> {
  const paymentIntentId = getPaymentIntentId(session.payment_intent);
  const now = new Date().toISOString();

  const { data: rows, error } = await supabase
    .from("ride_payments")
    .update({
      status,
      stripe_payment_intent_id: paymentIntentId,
      updated_at: now,
    })
    .eq("stripe_checkout_session_id", session.id)
    .select("ride_id, status");

  if (error) {
    console.error("Payment update error:", error);
    throw error;
  }

  if (rows && rows.length > 0) {
    console.log("Payment row updated:", {
      sessionId: session.id,
      status,
      paymentIntentId,
    });
    return true;
  }

  const rideId = session.metadata?.rideId || session.client_reference_id;
  const passengerId = session.metadata?.passengerId;

  if (!isValidRideId(rideId) || !passengerId) {
    console.error("Webhook is missing valid ride/passenger metadata.", {
      sessionId: session.id,
      rideId,
      passengerId,
    });
    return false;
  }

  const { data: existing, error: lookupError } = await supabase
    .from("ride_payments")
    .select("stripe_checkout_session_id")
    .eq("ride_id", rideId)
    .eq("passenger_id", passengerId)
    .maybeSingle();

  if (lookupError) {
    console.error("Payment lookup error:", lookupError);
    throw lookupError;
  }

  if (!existing) {
    console.error("No payment row found for webhook:", {
      sessionId: session.id,
      rideId,
    });
    return false;
  }

  if (
    existing.stripe_checkout_session_id &&
    existing.stripe_checkout_session_id !== session.id
  ) {
    console.error("Webhook session ID does not match the saved session.", {
      savedSessionId: existing.stripe_checkout_session_id,
      receivedSessionId: session.id,
    });
    return false;
  }

  const { data: fallbackRows, error: fallbackError } = await supabase
    .from("ride_payments")
    .update({
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      status,
      updated_at: now,
    })
    .eq("ride_id", rideId)
    .eq("passenger_id", passengerId)
    .select("ride_id, status");

  if (fallbackError) {
    console.error("Fallback payment update error:", fallbackError);
    throw fallbackError;
  }

  if (!fallbackRows || fallbackRows.length === 0) {
    console.error("Fallback did not update a payment row.", {
      sessionId: session.id,
      rideId,
    });
    return false;
  }

  console.log("Payment updated using ride metadata:", {
    rideId,
    status,
    paymentIntentId,
  });

  return true;
}

export function registerPaymentRoutes(app: Express): void {
  /**
   * Create a Stripe Checkout Session for a completed ride.
   */
  app.post(
    "/api/payments/checkout",
    async (req: Request, res: Response): Promise<void> => {
      const userId = getUserId(req);

      if (!userId) {
        res.status(401).json({ error: "Please sign in first." });
        return;
      }

      const stripeClient = getStripeClient(res);
      if (!stripeClient) return;

      const rideId = req.body?.rideId;

      if (!isValidRideId(rideId)) {
        res.status(400).json({ error: "Invalid ride ID." });
        return;
      }

      try {
        const { data: ride, error: rideError } = await supabase
          .from("rides")
          .select(
            "id, user_id, status, estimated_fare, pickup_name, dropoff_name"
          )
          .eq("id", rideId)
          .eq("user_id", userId)
          .maybeSingle();

        if (rideError) throw rideError;

        if (!ride) {
          res.status(404).json({
            error: "Ride not found or access denied.",
          });
          return;
        }

        if (ride.status !== "completed") {
          res.status(400).json({
            error: "You can pay only for completed rides.",
          });
          return;
        }

        const amountInPaise = Math.round(
          Number(ride.estimated_fare) * 100
        );

        if (!Number.isFinite(amountInPaise) || amountInPaise < 50) {
          res.status(400).json({ error: "Invalid ride fare." });
          return;
        }

        const { data: previousPayment, error: previousError } =
          await supabase
            .from("ride_payments")
            .select("id, status")
            .eq("ride_id", ride.id)
            .eq("passenger_id", userId)
            .maybeSingle();

        if (previousError) throw previousError;

        if (previousPayment?.status === "paid") {
          res.status(409).json({
            error: "This ride has already been paid for.",
          });
          return;
        }

        const now = new Date().toISOString();

        const { error: savePendingError } = await supabase
          .from("ride_payments")
          .upsert(
            {
              ride_id: ride.id,
              passenger_id: userId,
              amount: amountInPaise,
              currency: "inr",
              status: "pending",
              stripe_checkout_session_id: null,
              stripe_payment_intent_id: null,
              updated_at: now,
            },
            { onConflict: "ride_id" }
          );

        if (savePendingError) throw savePendingError;

        const session = await stripeClient.checkout.sessions.create({
          mode: "payment",
          client_reference_id: ride.id,
          metadata: {
            rideId: ride.id,
            passengerId: userId,
          },
          payment_intent_data: {
            metadata: {
              rideId: ride.id,
              passengerId: userId,
            },
          },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "inr",
                unit_amount: amountInPaise,
                product_data: {
                  name: "RideNow ride fare",
                  description: `${ride.pickup_name} to ${ride.dropoff_name}`,
                },
              },
            },
          ],
          success_url:
            `${FRONTEND_URL}/my-rides?payment=success&ride_id=${ride.id}`,
          cancel_url:
            `${FRONTEND_URL}/my-rides?payment=cancelled&ride_id=${ride.id}`,
        });

        if (!session.url) {
          throw new Error("Stripe did not return a checkout URL.");
        }

        const { error: sessionSaveError } = await supabase
          .from("ride_payments")
          .update({
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id: getPaymentIntentId(
              session.payment_intent
            ),
            status: "pending",
            updated_at: new Date().toISOString(),
          })
          .eq("ride_id", ride.id)
          .eq("passenger_id", userId);

        if (sessionSaveError) throw sessionSaveError;

        console.log("Checkout session created:", {
          rideId: ride.id,
          sessionId: session.id,
        });

        res.json({
          checkoutUrl: session.url,
          sessionId: session.id,
        });
      } catch (error) {
        console.error("Checkout creation failed:", error);
        res.status(500).json({
          error: "Unable to create checkout session.",
        });
      }
    }
  );

  /**
   * Retrieve the payment status for the signed-in passenger.
   */
  app.get(
    "/api/payments/ride/:rideId",
    async (req: Request, res: Response): Promise<void> => {
      const userId = getUserId(req);

      if (!userId) {
        res.status(401).json({ error: "Please sign in first." });
        return;
      }

      const rideId = req.params.rideId;

      if (!isValidRideId(rideId)) {
        res.status(400).json({ error: "Invalid ride ID." });
        return;
      }

      try {
        const { data: ride, error: rideError } = await supabase
          .from("rides")
          .select("id")
          .eq("id", rideId)
          .eq("user_id", userId)
          .maybeSingle();

        if (rideError) throw rideError;

        if (!ride) {
          res.status(404).json({ error: "Ride not found." });
          return;
        }

        const { data: payment, error: paymentError } = await supabase
          .from("ride_payments")
          .select(
            "ride_id, amount, currency, status, stripe_checkout_session_id, stripe_payment_intent_id, created_at, updated_at"
          )
          .eq("ride_id", rideId)
          .eq("passenger_id", userId)
          .maybeSingle();

        if (paymentError) throw paymentError;

        res.json({ payment: payment ?? null });
      } catch (error) {
        console.error("Payment status lookup failed:", error);
        res.status(500).json({
          error: "Unable to retrieve payment status.",
        });
      }
    }
  );

  /**
   * Stripe webhook.
   * index.ts must capture the raw body before JSON parsing changes it.
   */
  app.post(
    "/api/stripe/webhook",
    async (
      req: RawBodyRequest,
      res: Response
    ): Promise<void> => {
      const stripeClient = getStripeClient(res);
      if (!stripeClient) return;

      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      const signature = req.headers["stripe-signature"];

      if (!webhookSecret) {
        console.error("STRIPE_WEBHOOK_SECRET is missing.");
        res.status(503).json({
          error: "Stripe webhook is not configured.",
        });
        return;
      }

      if (!req.rawBody || typeof signature !== "string") {
        res.status(400).json({
          error: "Missing raw body or Stripe signature.",
        });
        return;
      }

      let event: Stripe.Event;

      try {
        event = stripeClient.webhooks.constructEvent(
          req.rawBody,
          signature,
          webhookSecret
        );
      } catch (error) {
        console.error("Webhook signature verification failed:", error);
        res.status(400).send("Invalid Stripe webhook signature.");
        return;
      }

      console.log("Stripe webhook received:", event.type);

      try {
        if (
          event.type === "checkout.session.completed" ||
          event.type === "checkout.session.async_payment_succeeded"
        ) {
          const session = event.data.object as Stripe.Checkout.Session;

          console.log("Checkout session details:", {
            sessionId: session.id,
            paymentStatus: session.payment_status,
            paymentIntentId: getPaymentIntentId(session.payment_intent),
            rideId: session.metadata?.rideId ?? session.client_reference_id,
            passengerId: session.metadata?.passengerId ?? null,
          });

          if (session.payment_status !== "paid") {
            console.log(
              "Session is not paid yet:",
              session.id,
              session.payment_status
            );
            res.json({ received: true, paymentUpdated: false });
            return;
          }

          const updated = await markPayment(session, "paid");

          if (!updated) {
            res.status(500).json({
              error: "No matching payment row was updated.",
            });
            return;
          }
        } else if (event.type === "checkout.session.expired") {
          const session = event.data.object as Stripe.Checkout.Session;
          await markPayment(session, "cancelled");
        } else if (event.type === "checkout.session.async_payment_failed") {
          const session = event.data.object as Stripe.Checkout.Session;
          await markPayment(session, "failed");
        }

        res.json({ received: true });
      } catch (error) {
        console.error("Stripe webhook processing failed:", error);
        res.status(500).json({
          error: "Webhook processing failed.",
        });
      }
    }
  );
}
