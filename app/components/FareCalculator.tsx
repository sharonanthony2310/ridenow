
"use client";

type CabType = "Mini" | "Sedan" | "XL";

type FareCalculatorProps = {
  distanceKm: number | null;
  cabType: CabType;
  onCabTypeChange: (type: CabType) => void;
};

const cabOptions: {
  type: CabType;
  ratePerKm: number;
  baseFare: number;
  description: string;
}[] = [
  {
    type: "Mini",
    ratePerKm: 12,
    baseFare: 40,
    description: "Affordable everyday rides",
  },
  {
    type: "Sedan",
    ratePerKm: 18,
    baseFare: 60,
    description: "Comfortable city travel",
  },
  {
    type: "XL",
    ratePerKm: 24,
    baseFare: 80,
    description: "Extra space for passengers",
  },
];

export default function FareCalculator({
  distanceKm,
  cabType,
  onCabTypeChange,
}: FareCalculatorProps) {
  const selectedCab = cabOptions.find((cab) => cab.type === cabType)!;

  const estimatedFare =
    distanceKm !== null && distanceKm > 0
      ? Math.round(selectedCab.baseFare + distanceKm * selectedCab.ratePerKm)
      : null;

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 p-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Choose your ride
        </h2>
        <p className="text-sm text-gray-500">
          Select a cab type to see your estimated fare.
        </p>
      </div>

      <div className="space-y-3">
        {cabOptions.map((cab) => {
          const fare =
            distanceKm !== null && distanceKm > 0
              ? Math.round(cab.baseFare + distanceKm * cab.ratePerKm)
              : null;

          return (
            <button
              key={cab.type}
              type="button"
              onClick={() => onCabTypeChange(cab.type)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border p-4 text-left ${
                cabType === cab.type
                  ? "border-black bg-gray-50 ring-1 ring-black"
                  : "border-gray-200"
              }`}
            >
              <div>
                <p className="font-semibold text-gray-900">{cab.type}</p>
                <p className="text-sm text-gray-500">{cab.description}</p>
              </div>

              <div className="text-right">
                <p className="font-semibold text-gray-900">
                  {fare !== null ? `₹${fare}` : "—"}
                </p>
                <p className="text-xs text-gray-500">
                  ₹{cab.baseFare} + ₹{cab.ratePerKm}/km
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg bg-gray-50 p-4">
        <p className="text-sm text-gray-500">Estimated {cabType} fare</p>
        <p className="text-2xl font-bold text-gray-900">
          {estimatedFare !== null ? `₹${estimatedFare}` : "Calculate your route first"}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Demo pricing only. Actual fares may include waiting time, tolls,
          taxes, and other applicable charges.
        </p>
      </div>
    </section>
  );
}
