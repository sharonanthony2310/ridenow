
"use client";

import { useEffect, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type MapPoint = {
  lat: number;
  lng: number;
  name: string;
};

type TripMapInnerProps = {
  pickup: MapPoint;
  dropoff: MapPoint;
  driver?: MapPoint;
};

type RouteCoordinates = [number, number][];

function createIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border:3px solid white;border-radius:50%;background:${color};box-shadow:0 1px 5px #555"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

const pickupIcon = createIcon("#16a34a");
const dropoffIcon = createIcon("#dc2626");
const driverIcon = createIcon("#2563eb");

function FitMap({
  pickup,
  dropoff,
  driver,
}: TripMapInnerProps) {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = [
      [pickup.lat, pickup.lng],
      [dropoff.lat, dropoff.lng],
    ];

    if (driver) {
      points.push([driver.lat, driver.lng]);
    }

    map.fitBounds(points, { padding: [35, 35] });
  }, [
    map,
    pickup.lat,
    pickup.lng,
    dropoff.lat,
    dropoff.lng,
    driver?.lat,
    driver?.lng,
  ]);

  return null;
}

export default function TripMapInner({
  pickup,
  dropoff,
  driver,
}: TripMapInnerProps) {
  const [route, setRoute] = useState<RouteCoordinates>([]);
  const [routeError, setRouteError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadRoute() {
      try {
        setRouteError(false);

        const url =
          `https://router.project-osrm.org/route/v1/driving/` +
          `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}` +
          `?overview=full&geometries=geojson`;

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error("Route request failed.");
        }

        const data = await response.json();
        const coordinates = data.routes?.[0]?.geometry?.coordinates;

        if (!Array.isArray(coordinates)) {
          throw new Error("Route unavailable.");
        }

        const converted: RouteCoordinates = coordinates.map(
          (coordinate: [number, number]) => [
            coordinate[1],
            coordinate[0],
          ]
        );

        if (!cancelled) {
          setRoute(converted);
        }
      } catch {
        if (!cancelled) {
          setRoute([]);
          setRouteError(true);
        }
      }
    }

    void loadRoute();

    return () => {
      cancelled = true;
    };
  }, [pickup.lat, pickup.lng, dropoff.lat, dropoff.lng]);

  const center: [number, number] = [
    pickup.lat,
    pickup.lng,
  ];

  return (
    <div>
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom
        style={{ height: "320px", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitMap
          pickup={pickup}
          dropoff={dropoff}
          driver={driver}
        />

        <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon}>
          <Popup>Pickup: {pickup.name}</Popup>
        </Marker>

        <Marker
          position={[dropoff.lat, dropoff.lng]}
          icon={dropoffIcon}
        >
          <Popup>Drop-off: {dropoff.name}</Popup>
        </Marker>

        {route.length > 0 && (
          <Polyline
            positions={route}
            pathOptions={{
              color: "#2563eb",
              weight: 5,
              opacity: 0.8,
            }}
          />
        )}

        {driver && (
          <Marker
            position={[driver.lat, driver.lng]}
            icon={driverIcon}
          >
            <Popup>
              {driver.name}
              <br />
              Current driver location
            </Popup>
          </Marker>
        )}
      </MapContainer>

      <div className="flex flex-wrap gap-4 bg-white px-3 py-3 text-xs text-gray-700">
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-green-600" />
          Pickup
        </span>

        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-600" />
          Drop-off
        </span>

        {driver && (
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-blue-600" />
            Driver
          </span>
        )}

        {routeError && (
          <span className="text-amber-700">
            Route unavailable. Map markers are still shown.
          </span>
        )}
      </div>
    </div>
  );
}
