
"use client";

import { useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";

type Location = {
  lat: number;
  lng: number;
};

type MapPickerProps = {
  onPickupChange: (location: Location) => void;
  onDropoffChange: (location: Location) => void;
};

const pickupIcon = L.divIcon({
  className: "",
  html: '<div style="background:#16a34a;width:18px;height:18px;border:3px solid white;border-radius:50%;box-shadow:0 1px 5px #555"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const dropoffIcon = L.divIcon({
  className: "",
  html: '<div style="background:#dc2626;width:18px;height:18px;border:3px solid white;border-radius:50%;box-shadow:0 1px 5px #555"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function MapClickHandler({
  mode,
  onPickupChange,
  onDropoffChange,
}: {
  mode: "pickup" | "dropoff";
  onPickupChange: (location: Location) => void;
  onDropoffChange: (location: Location) => void;
}) {
  useMapEvents({
    click(event) {
      const location = {
        lat: Number(event.latlng.lat.toFixed(6)),
        lng: Number(event.latlng.lng.toFixed(6)),
      };

      if (mode === "pickup") {
        onPickupChange(location);
      } else {
        onDropoffChange(location);
      }
    },
  });

  return null;
}

export default function MapPicker({
  onPickupChange,
  onDropoffChange,
}: MapPickerProps) {
  const [mode, setMode] = useState<"pickup" | "dropoff">("pickup");
  const [pickup, setPickup] = useState<Location | null>(null);
  const [dropoff, setDropoff] = useState<Location | null>(null);

  function updatePickup(location: Location) {
    setPickup(location);
    onPickupChange(location);
  }

  function updateDropoff(location: Location) {
    setDropoff(location);
    onDropoffChange(location);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("pickup")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            mode === "pickup"
              ? "bg-green-600 text-white"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          Select pickup
        </button>

        <button
          type="button"
          onClick={() => setMode("dropoff")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            mode === "dropoff"
              ? "bg-red-600 text-white"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          Select destination
        </button>
      </div>

      <p className="text-sm text-gray-600">
        {mode === "pickup"
          ? "Click the map to select your pickup location."
          : "Click the map to select your destination."}
      </p>

      <MapContainer
        center={[19.076, 72.8777]}
        zoom={12}
        scrollWheelZoom
        style={{ height: "400px", width: "100%", borderRadius: "12px" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapClickHandler
          mode={mode}
          onPickupChange={updatePickup}
          onDropoffChange={updateDropoff}
        />

        {pickup && <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon} />}
        {dropoff && <Marker position={[dropoff.lat, dropoff.lng]} icon={dropoffIcon} />}
      </MapContainer>

      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p className="rounded-lg bg-green-50 p-3 text-green-800">
          <strong>Pickup:</strong>{" "}
          {pickup
            ? `${pickup.lat}, ${pickup.lng}`
            : "Not selected yet"}
        </p>
        <p className="rounded-lg bg-red-50 p-3 text-red-800">
          <strong>Destination:</strong>{" "}
          {dropoff
            ? `${dropoff.lat}, ${dropoff.lng}`
            : "Not selected yet"}
        </p>
      </div>
    </div>
  );
}
