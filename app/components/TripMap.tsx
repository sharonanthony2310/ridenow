
"use client";

import dynamic from "next/dynamic";

type MapPoint = {
  lat: number;
  lng: number;
  name: string;
};

type TripMapProps = {
  pickup: MapPoint;
  dropoff: MapPoint;
  driver?: MapPoint;
};

const TripMapInner = dynamic<TripMapProps>(
  () =>
    import("./TripMapInner").then(
      (module) => module.default
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-72 items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-600">
        Loading trip map...
      </div>
    ),
  }
);

export default function TripMap(props: TripMapProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <TripMapInner {...props} />
    </div>
  );
}
