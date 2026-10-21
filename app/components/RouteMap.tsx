
"use client";

import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { useEffect } from "react";
import L from "leaflet";

export type MapLocation = {
  lat: number;
  lng: number;
};

type RouteMapProps = {
  pickup: MapLocation | null;
  dropoff: MapLocation | null;
  route: [number, number][] | null;
  selectionMode: "pickup" | "dropoff";
  onMapSelect: (location: MapLocation) => void;
};

const pickupIcon = L.divIcon({
  className: "",
  html: '<div style="width:18px;height:18px;background:#16a34a;border:3px solid white;border-radius:50%;box-shadow:0 1px 5px #555"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const dropoffIcon = L.divIcon({
  className: "",
  html: '<div style="width:18px;height:18px;background:#dc2626;border:3px solid white;border-radius:50%;box-shadow:0 1px 5px #555"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function MapClickHandler({
  onMapSelect,
}: {
  onMapSelect: (location: MapLocation) => void;
}) {
  useMapEvents({
    click(event) {
      onMapSelect({
        lat: Number(event.latlng.lat.toFixed(6)),
        lng: Number(event.latlng.lng.toFixed(6)),
      });
    },
  });

  return null;
}

function FitRoute({
  pickup,
  dropoff,
  route,
}: {
  pickup: MapLocation | null;
  dropoff: MapLocation | null;
  route: [number, number][] | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (route?.length) {
      map.fitBounds(route, { padding: [35, 35] });
    } else if (pickup && dropoff) {
      map.fitBounds(
        [
          [pickup.lat, pickup.lng],
          [dropoff.lat, dropoff.lng],
        ],
        { padding: [35, 35] }
      );
    } else if (pickup) {
      map.setView([pickup.lat, pickup.lng], 14);
    } else if (dropoff) {
      map.setView([dropoff.lat, dropoff.lng], 14);
    }
  }, [map, pickup, dropoff, route]);

  return null;
}

export default function RouteMap({
  pickup,
  dropoff,
  route,
  selectionMode,
  onMapSelect,
}: RouteMapProps) {
  return (
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

      <MapClickHandler onMapSelect={onMapSelect} />

      {pickup && (
        <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon} />
      )}

      {dropoff && (
        <Marker position={[dropoff.lat, dropoff.lng]} icon={dropoffIcon} />
      )}

      {route && (
        <Polyline
          positions={route}
          pathOptions={{ color: "#2563eb", weight: 5 }}
        />
      )}

      <FitRoute pickup={pickup} dropoff={dropoff} route={route} />
    </MapContainer>
  );
}
