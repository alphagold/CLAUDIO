import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Icon } from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface PhotoMapProps {
  latitude: number;
  longitude: number;
  locationName?: string | null;
  takenAt: string;
}

// Fix for default marker icon
const defaultIcon = new Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function PhotoMap({ latitude, longitude, locationName, takenAt }: PhotoMapProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Unique key to prevent Leaflet double-initialization in React 19
  const mapKey = `map-${latitude}-${longitude}`;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-4 border-b border-gray-200">
        <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
          <span>📍</span>
          <span>Posizione</span>
        </h3>
        {locationName && (
          <p className="text-sm text-gray-600 mt-1">{locationName}</p>
        )}
        <p className="text-xs text-gray-500 mt-1">{formatDate(takenAt)}</p>
      </div>
      <div className="h-64 relative" key={mapKey}>
        <MapContainer
          key={mapKey}
          center={[latitude, longitude]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={[latitude, longitude]} icon={defaultIcon}>
            <Popup>
              <div className="text-center">
                <p className="font-semibold">{locationName || 'Foto scattata qui'}</p>
                <p className="text-xs text-gray-500 mt-1">{formatDate(takenAt)}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {latitude.toFixed(6)}, {longitude.toFixed(6)}
                </p>
              </div>
            </Popup>
          </Marker>
        </MapContainer>
      </div>
    </div>
  );
}
