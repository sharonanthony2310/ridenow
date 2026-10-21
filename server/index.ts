
import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { supabase } from "./supabase";
import { registerPaymentRoutes } from "./payments";
import { registerReviewRoutes } from "./reviews";

const app = express();
const PORT = Number(process.env.PORT || 4000);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

type CabType = "Mini" | "Sedan" | "XL";

type RideRequestBody = {
  pickup?: { name?: string; lat?: number; lng?: number };
  dropoff?: { name?: string; lat?: number; lng?: number };
  cabType?: CabType;
  distanceKm?: number;
  passengerCount?: number;
};

type DriverProfileBody = {
  displayName?: unknown;
  phone?: unknown;
  vehicleMake?: unknown;
  vehicleModel?: unknown;
  vehicleColor?: unknown;
  vehiclePlate?: unknown;
};

const fareRates: Record<CabType, { base: number; perKm: number }> = {
  Mini: { base: 40, perKm: 12 },
  Sedan: { base: 60, perKm: 18 },
  XL: { base: 80, perKm: 24 },
};

app.use(
  cors({
    origin: FRONTEND_URL,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
  })
);

// Preserve the raw body so Stripe can verify webhook signatures.
app.use(
  express.json({
    limit: "20kb",
    verify: (req, _res, buffer) => {
      if (req.originalUrl === "/api/stripe/webhook") {
        (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      }
    },
  })
);

app.use(clerkMiddleware());

function authenticatedUserId(req: Request): string | null {
  const auth = getAuth(req);
  return auth.isAuthenticated ? auth.userId : null;
}

async function requireDriver(
  req: Request,
  res: Response
): Promise<string | null> {
  const userId = authenticatedUserId(req);

  if (!userId) {
    res.status(401).json({ error: "Please sign in first." });
    return null;
  }

  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Driver role lookup failed:", error.message);
    res.status(500).json({ error: "Could not verify driver access." });
    return null;
  }

  if (!data || !["driver", "admin"].includes(data.role)) {
    res.status(403).json({
      error: "Driver access is required for this action.",
    });
    return null;
  }

  return userId;
}

function validRideId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
}

function optionalProfileText(
  value: unknown,
  fieldName: string,
  maxLength: number
): { value?: string | null; error?: string } {
  if (value === undefined) return {};
  if (value === null) return { value: null };

  if (typeof value !== "string") {
    return { error: `${fieldName} must be text.` };
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    return {
      error: `${fieldName} must be ${maxLength} characters or fewer.`,
    };
  }

  return { value: trimmed || null };
}

function requiredProfileText(
  value: unknown,
  fieldName: string,
  maxLength: number
): { value?: string; error?: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { error: `${fieldName} is required.` };
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    return {
      error: `${fieldName} must be ${maxLength} characters or fewer.`,
    };
  }

  return { value: trimmed };
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "RideNow API" });
});

// Register payment and review endpoints.
registerPaymentRoutes(app);
registerReviewRoutes(app);

// Rider: view only their own bookings, with driver details and live location.
app.get("/api/rides/mine", async (req, res) => {
  const userId = authenticatedUserId(req);

  if (!userId) {
    return res.status(401).json({
      error: "Please sign in to view your rides.",
    });
  }

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Ride history lookup failed:", error.message);
    return res.status(500).json({
      error: "Could not load your ride history.",
    });
  }

  const rides = data ?? [];

  const driverIds = [
    ...new Set(
      rides
        .map((ride) => ride.driver_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];

  let profilesById: Record<
    string,
    {
      display_name: string;
      phone: string | null;
      vehicle_make: string | null;
      vehicle_model: string | null;
      vehicle_color: string | null;
      vehicle_plate: string | null;
    }
  > = {};

  if (driverIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("driver_profiles")
      .select(
        "clerk_user_id, display_name, phone, vehicle_make, vehicle_model, vehicle_color, vehicle_plate"
      )
      .in("clerk_user_id", driverIds);

    if (profileError) {
      console.error("Driver profile lookup failed:", profileError.message);
      return res.status(500).json({
        error: "Could not load driver details for your rides.",
      });
    }

    profilesById = Object.fromEntries(
      (profiles ?? []).map((profile) => [
        profile.clerk_user_id,
        {
          display_name: profile.display_name,
          phone: profile.phone,
          vehicle_make: profile.vehicle_make,
          vehicle_model: profile.vehicle_model,
          vehicle_color: profile.vehicle_color,
          vehicle_plate: profile.vehicle_plate,
        },
      ])
    );
  }

  const activeRideIds = rides
    .filter(
      (ride) =>
        ride.status === "accepted" || ride.status === "in_progress"
    )
    .map((ride) => ride.id);

  let locationsByRideId: Record<
    string,
    { latitude: number; longitude: number; updated_at: string }
  > = {};

  if (activeRideIds.length > 0 && driverIds.length > 0) {
    const { data: locations, error: locationError } = await supabase
      .from("driver_locations")
      .select("ride_id, latitude, longitude, updated_at")
      .in("ride_id", activeRideIds)
      .in("driver_id", driverIds);

    if (locationError) {
      console.error("Driver location lookup failed:", locationError.message);
      return res.status(500).json({
        error: "Could not load driver locations.",
      });
    }

    locationsByRideId = Object.fromEntries(
      (locations ?? []).map((location) => [
        location.ride_id,
        {
          latitude: location.latitude,
          longitude: location.longitude,
          updated_at: location.updated_at,
        },
      ])
    );
  }

  return res.json({
    rides: rides.map((ride) => ({
      ...ride,
      driver_profile:
        typeof ride.driver_id === "string"
          ? profilesById[ride.driver_id] ?? null
          : null,
      driver_location: locationsByRideId[ride.id] ?? null,
    })),
  });
});

// Rider: create a booking.
app.post("/api/rides", async (req, res) => {
  const userId = authenticatedUserId(req);

  if (!userId) {
    return res.status(401).json({
      error: "Please sign in before booking a ride.",
    });
  }

  const body = (req.body ?? {}) as RideRequestBody;
  const { pickup, dropoff, cabType, distanceKm, passengerCount } = body;

  const validLocation = (location: RideRequestBody["pickup"]) =>
    location &&
    typeof location.name === "string" &&
    location.name.trim().length > 0 &&
    typeof location.lat === "number" &&
    Number.isFinite(location.lat) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    typeof location.lng === "number" &&
    Number.isFinite(location.lng) &&
    location.lng >= -180 &&
    location.lng <= 180;

  if (
    !validLocation(pickup) ||
    !validLocation(dropoff) ||
    !cabType ||
    !Object.prototype.hasOwnProperty.call(fareRates, cabType) ||
    typeof distanceKm !== "number" ||
    !Number.isFinite(distanceKm) ||
    distanceKm <= 0 ||
    distanceKm > 1000 ||
    !Number.isInteger(passengerCount) ||
    passengerCount! < 1 ||
    passengerCount! > 6
  ) {
    return res.status(400).json({
      error: "Invalid ride details. Check your locations and selections.",
    });
  }

  const rate = fareRates[cabType];
  const estimatedFare = Number(
    (rate.base + distanceKm * rate.perKm).toFixed(2)
  );

  const { data, error } = await supabase
    .from("rides")
    .insert({
      user_id: userId,
      pickup_name: pickup!.name!.trim(),
      pickup_lat: pickup!.lat,
      pickup_lng: pickup!.lng,
      dropoff_name: dropoff!.name!.trim(),
      dropoff_lat: dropoff!.lat,
      dropoff_lng: dropoff!.lng,
      cab_type: cabType,
      distance_km: distanceKm,
      estimated_fare: estimatedFare,
      passenger_count: passengerCount,
      status: "requested",
    })
    .select("*")
    .single();

  if (error) {
    console.error("Ride creation failed:", error.message);
    return res.status(500).json({
      error: "Could not create the booking. Please try again.",
    });
  }

  return res.status(201).json({ ride: data });
});

// Rider: cancel only their own unassigned requested ride.
app.post("/api/rides/:id/cancel", async (req, res) => {
  const userId = authenticatedUserId(req);

  if (!userId) {
    return res.status(401).json({
      error: "Please sign in to cancel a ride.",
    });
  }

  const rideId = req.params.id;

  if (!validRideId(rideId)) {
    return res.status(400).json({ error: "Invalid ride ID." });
  }

  const { data, error } = await supabase
    .from("rides")
    .update({ status: "cancelled" })
    .eq("id", rideId)
    .eq("user_id", userId)
    .eq("status", "requested")
    .is("driver_id", null)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("Rider cancellation failed:", error.message);
    return res.status(500).json({
      error: "Could not cancel this ride.",
    });
  }

  if (!data) {
    return res.status(409).json({
      error:
        "This ride can no longer be cancelled here. It may already have been accepted or changed.",
    });
  }

  return res.json({ ride: data });
});

// Driver: read their own profile.
app.get("/api/driver/profile", async (req, res) => {
  const driverId = await requireDriver(req, res);
  if (!driverId) return;

  const { data, error } = await supabase
    .from("driver_profiles")
    .select(
      "clerk_user_id, display_name, phone, vehicle_make, vehicle_model, vehicle_color, vehicle_plate, created_at, updated_at"
    )
    .eq("clerk_user_id", driverId)
    .maybeSingle();

  if (error) {
    console.error("Driver profile lookup failed:", error.message);
    return res.status(500).json({
      error: "Could not load your driver profile.",
    });
  }

  return res.json({ profile: data ?? null });
});

// Driver: create or update their own profile.
app.post("/api/driver/profile", async (req, res) => {
  const driverId = await requireDriver(req, res);
  if (!driverId) return;

  const body = (req.body ?? {}) as DriverProfileBody;
  const displayName = requiredProfileText(body.displayName, "Display name", 80);
  const phone = optionalProfileText(body.phone, "Phone number", 30);
  const vehicleMake = optionalProfileText(body.vehicleMake, "Vehicle make", 50);
  const vehicleModel = optionalProfileText(body.vehicleModel, "Vehicle model", 50);
  const vehicleColor = optionalProfileText(body.vehicleColor, "Vehicle colour", 30);
  const vehiclePlate = optionalProfileText(body.vehiclePlate, "Vehicle registration", 20);

  const validationError =
    displayName.error ||
    phone.error ||
    vehicleMake.error ||
    vehicleModel.error ||
    vehicleColor.error ||
    vehiclePlate.error;

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const { data, error } = await supabase
    .from("driver_profiles")
    .upsert(
      {
        clerk_user_id: driverId,
        display_name: displayName.value,
        phone: phone.value ?? null,
        vehicle_make: vehicleMake.value ?? null,
        vehicle_model: vehicleModel.value ?? null,
        vehicle_color: vehicleColor.value ?? null,
        vehicle_plate: vehiclePlate.value ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_user_id" }
    )
    .select(
      "clerk_user_id, display_name, phone, vehicle_make, vehicle_model, vehicle_color, vehicle_plate, created_at, updated_at"
    )
    .single();

  if (error) {
    console.error("Driver profile save failed:", error.message);
    return res.status(500).json({
      error: "Could not save your driver profile.",
    });
  }

  return res.json({ profile: data });
});

// Driver: view available ride requests.
app.get("/api/driver/rides", async (req, res) => {
  const driverId = await requireDriver(req, res);
  if (!driverId) return;

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("status", "requested")
    .is("driver_id", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Available ride lookup failed:", error.message);
    return res.status(500).json({
      error: "Could not load available rides.",
    });
  }

  return res.json({ rides: data ?? [] });
});

// Driver: view rides assigned to their own account.
app.get("/api/driver/rides/assigned", async (req, res) => {
  const driverId = await requireDriver(req, res);
  if (!driverId) return;

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("driver_id", driverId)
    .in("status", ["accepted", "in_progress", "completed", "cancelled"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Assigned ride lookup failed:", error.message);
    return res.status(500).json({
      error: "Could not load your assigned rides.",
    });
  }

  return res.json({ rides: data ?? [] });
});

// Driver: accept an unassigned request.
app.post("/api/driver/rides/:id/accept", async (req, res) => {
  const driverId = await requireDriver(req, res);
  if (!driverId) return;

  const rideId = req.params.id;

  if (!validRideId(rideId)) {
    return res.status(400).json({ error: "Invalid ride ID." });
  }

  const { data, error } = await supabase
    .from("rides")
    .update({
      status: "accepted",
      driver_id: driverId,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", rideId)
    .eq("status", "requested")
    .is("driver_id", null)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("Ride acceptance failed:", error.message);
    return res.status(500).json({
      error: "Could not accept this ride.",
    });
  }

  if (!data) {
    return res.status(409).json({
      error: "This ride is no longer available. Refresh the ride list.",
    });
  }

  return res.json({ ride: data });
});

// Driver: start, complete, or cancel an assigned ride.
app.post("/api/driver/rides/:id/:action", async (req, res) => {
  const driverId = await requireDriver(req, res);
  if (!driverId) return;

  const rideId = req.params.id;

  if (!validRideId(rideId)) {
    return res.status(400).json({ error: "Invalid ride ID." });
  }

  const transitions: Record<string, { from: string; to: string }> = {
    start: { from: "accepted", to: "in_progress" },
    complete: { from: "in_progress", to: "completed" },
    cancel: { from: "accepted", to: "cancelled" },
  };

  const transition = transitions[req.params.action];

  if (!transition) {
    return res.status(400).json({
      error: "Unknown action. Use start, complete, or cancel.",
    });
  }

  const { data, error } = await supabase
    .from("rides")
    .update({ status: transition.to })
    .eq("id", rideId)
    .eq("driver_id", driverId)
    .eq("status", transition.from)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("Driver ride action failed:", error.message);
    return res.status(500).json({
      error: "Could not update this ride.",
    });
  }

  if (!data) {
    return res.status(409).json({
      error:
        "This ride cannot be changed. It may have a different status or belong to another driver.",
    });
  }

  return res.json({ ride: data });
});

// Driver: share current GPS location for an assigned ride in progress.
app.post("/api/driver/location", async (req, res) => {
  const driverId = await requireDriver(req, res);
  if (!driverId) return;

  const { rideId, latitude, longitude } = req.body ?? {};

  if (
    !validRideId(rideId) ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return res.status(400).json({
      error: "A valid ride ID and GPS coordinates are required.",
    });
  }

  const { data: ride, error: rideError } = await supabase
    .from("rides")
    .select("id")
    .eq("id", rideId)
    .eq("driver_id", driverId)
    .eq("status", "in_progress")
    .maybeSingle();

  if (rideError) {
    console.error("Driver location ride lookup failed:", rideError.message);
    return res.status(500).json({
      error: "Could not verify this ride.",
    });
  }

  if (!ride) {
    return res.status(403).json({
      error: "Location can be shared only for your own ride in progress.",
    });
  }

  const { data, error } = await supabase
    .from("driver_locations")
    .upsert(
      {
        driver_id: driverId,
        ride_id: rideId,
        latitude,
        longitude,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "driver_id" }
    )
    .select("ride_id, latitude, longitude, updated_at")
    .single();

  if (error) {
    console.error("Driver GPS update failed:", error.message);
    return res.status(500).json({
      error: "Could not update driver location.",
    });
  }

  return res.json({ location: data });
});

// Driver: stop sharing GPS location for a ride.
app.delete("/api/driver/location/:rideId", async (req, res) => {
  const driverId = await requireDriver(req, res);
  if (!driverId) return;

  const rideId = req.params.rideId;

  if (!validRideId(rideId)) {
    return res.status(400).json({ error: "Invalid ride ID." });
  }

  const { error } = await supabase
    .from("driver_locations")
    .delete()
    .eq("driver_id", driverId)
    .eq("ride_id", rideId);

  if (error) {
    console.error("Driver GPS cleanup failed:", error.message);
    return res.status(500).json({
      error: "Could not stop location sharing.",
    });
  }

  return res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`RideNow API running at http://localhost:${PORT}`);
});
