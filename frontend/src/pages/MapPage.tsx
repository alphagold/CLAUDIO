import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Icon } from 'leaflet';
import { Link } from 'react-router-dom';
import { photosApi } from '../api/client';
import Layout from '../components/Layout';
import { Loader, MapPin, Calendar } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

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

export default function MapPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['photos', 'all'],
    queryFn: () => photosApi.getPhotos({ limit: 1000 }),
  });

  const photos = data?.photos || [];

  // Filter photos with GPS coordinates
  const photosWithGPS = photos.filter(p => p.latitude && p.longitude);

  // Calculate map center (average of all coordinates)
  const mapCenter: [number, number] = photosWithGPS.length > 0
    ? [
        photosWithGPS.reduce((sum, p) => sum + (p.latitude || 0), 0) / photosWithGPS.length,
        photosWithGPS.reduce((sum, p) => sum + (p.longitude || 0), 0) / photosWithGPS.length,
      ]
    : [41.9028, 12.4964]; // Rome as default

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <Layout>
      <div className="h-screen pt-16">
        {/* Header */}
        <div className="absolute top-20 left-4 right-4 z-[1000] pointer-events-none">
          <div className="max-w-7xl mx-auto">
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-4 pointer-events-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <MapPin className="w-6 h-6 text-blue-600" />
                  <div>
                    <h1 className="text-xl font-bold text-gray-900">Mappa Foto</h1>
                    <p className="text-sm text-gray-600">
                      {photosWithGPS.length} foto geolocalizzate su {photos.length} totali
                    </p>
                  </div>
                </div>
                {isLoading && (
                  <Loader className="w-5 h-5 text-blue-600 animate-spin" />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Map */}
        {isLoading ? (
          <div className="h-full flex items-center justify-center bg-gray-100">
            <div className="text-center">
              <Loader className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
              <p className="text-gray-600">Caricamento foto...</p>
            </div>
          </div>
        ) : photosWithGPS.length === 0 ? (
          <div className="h-full flex items-center justify-center bg-gray-100">
            <div className="text-center">
              <MapPin className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Nessuna foto geolocalizzata</h2>
              <p className="text-gray-600">
                Carica foto con dati GPS per vederle sulla mappa
              </p>
            </div>
          </div>
        ) : (
          <MapContainer
            center={mapCenter}
            zoom={6}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {photosWithGPS.map((photo) => (
              <Marker
                key={photo.id}
                position={[photo.latitude!, photo.longitude!]}
                icon={defaultIcon}
              >
                <Popup>
                  <Link to={`/photos/${photo.id}`} className="block hover:opacity-80 transition">
                    <div className="w-48">
                      {/* Thumbnail */}
                      <img
                        src={photosApi.getThumbnailUrl(photo.id, 128)}
                        alt={photo.analysis?.description_short || 'Photo'}
                        className="w-full h-32 object-cover rounded-lg mb-2"
                      />

                      {/* Info */}
                      <div className="space-y-1">
                        {photo.analysis?.description_short && (
                          <p className="text-sm font-medium text-gray-900 line-clamp-2">
                            {photo.analysis.description_short}
                          </p>
                        )}
                        {photo.location_name && (
                          <div className="flex items-center space-x-1 text-xs text-gray-600">
                            <MapPin className="w-3 h-3" />
                            <span>{photo.location_name}</span>
                          </div>
                        )}
                        <div className="flex items-center space-x-1 text-xs text-gray-500">
                          <Calendar className="w-3 h-3" />
                          <span>{formatDate(photo.taken_at || photo.uploaded_at)}</span>
                        </div>
                      </div>

                      {/* Tags */}
                      {photo.analysis?.tags && photo.analysis.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {photo.analysis.tags.slice(0, 3).map((tag, idx) => (
                            <span
                              key={idx}
                              className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </Link>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>
    </Layout>
  );
}
