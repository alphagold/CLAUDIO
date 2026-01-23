import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { DivIcon } from 'leaflet';
import { Link } from 'react-router-dom';
import { photosApi } from '../api/client';
import Layout from '../components/Layout';
import { Loader, MapPin, Calendar, Image as ImageIcon } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

// Custom animated marker icon with pulse effect
const createCustomIcon = (thumbnailUrl: string) => {
  return new DivIcon({
    html: `
      <div class="relative group cursor-pointer">
        <div class="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full blur-md opacity-50 animate-pulse"></div>
        <div class="relative w-10 h-10 rounded-full border-3 border-white shadow-lg overflow-hidden bg-gradient-to-br from-blue-500 to-purple-500 transform transition-transform group-hover:scale-125 group-hover:rotate-12">
          <img src="${thumbnailUrl}" class="w-full h-full object-cover" alt="" />
        </div>
        <div class="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white animate-pulse"></div>
      </div>
    `,
    className: 'custom-marker',
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40],
  });
};

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

  // Unique key to prevent Leaflet double-initialization in React 19
  const mapKey = `map-page-${photosWithGPS.length}`;

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
            <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/50 p-6 pointer-events-auto animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl blur opacity-50 animate-pulse"></div>
                    <div className="relative p-3 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl shadow-lg">
                      <MapPin className="w-6 h-6 text-white" />
                    </div>
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                      Mappa Foto
                    </h1>
                    <p className="text-sm text-gray-600 font-medium">
                      <span className="text-blue-600 font-bold">{photosWithGPS.length}</span> foto geolocalizzate su{' '}
                      <span className="text-gray-900 font-bold">{photos.length}</span> totali
                    </p>
                  </div>
                </div>
                {isLoading && (
                  <Loader className="w-6 h-6 text-blue-600 animate-spin" />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Map */}
        {isLoading ? (
          <div className="h-full flex items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
            <div className="text-center animate-fade-in">
              <div className="relative inline-block mb-6">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full blur-xl opacity-50 animate-pulse"></div>
                <div className="relative p-6 bg-white rounded-full shadow-2xl">
                  <Loader className="w-12 h-12 text-blue-600 animate-spin" />
                </div>
              </div>
              <p className="text-lg font-semibold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                Caricamento foto...
              </p>
            </div>
          </div>
        ) : photosWithGPS.length === 0 ? (
          <div className="h-full flex items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
            <div className="text-center animate-fade-in">
              <div className="relative inline-block mb-6">
                <div className="absolute inset-0 bg-gradient-to-r from-gray-400 to-gray-500 rounded-full blur-xl opacity-30"></div>
                <div className="relative p-8 bg-white rounded-full shadow-2xl">
                  <MapPin className="w-16 h-16 text-gray-400" />
                </div>
              </div>
              <h2 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent mb-3">
                Nessuna foto geolocalizzata
              </h2>
              <p className="text-gray-600 text-lg">
                Carica foto con dati GPS per vederle sulla mappa
              </p>
            </div>
          </div>
        ) : (
          <MapContainer
            key={mapKey}
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
                icon={createCustomIcon(photosApi.getThumbnailUrl(photo.id, 64))}
              >
                <Popup className="custom-popup">
                  <Link to={`/photos/${photo.id}`} className="block group">
                    <div className="w-64">
                      {/* Thumbnail with gradient overlay */}
                      <div className="relative overflow-hidden rounded-xl mb-3 shadow-lg">
                        <img
                          src={photosApi.getThumbnailUrl(photo.id, 256)}
                          alt={photo.analysis?.description_short || 'Photo'}
                          className="w-full h-40 object-cover transform group-hover:scale-110 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      </div>

                      {/* Info */}
                      <div className="space-y-2">
                        {photo.analysis?.description_short && (
                          <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug">
                            {photo.analysis.description_short}
                          </p>
                        )}
                        {photo.location_name && (
                          <div className="flex items-center space-x-2 text-xs text-gray-600 bg-blue-50 px-3 py-1.5 rounded-lg">
                            <MapPin className="w-3.5 h-3.5 text-blue-600" />
                            <span className="font-medium">{photo.location_name}</span>
                          </div>
                        )}
                        <div className="flex items-center space-x-2 text-xs text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg">
                          <Calendar className="w-3.5 h-3.5" />
                          <span className="font-medium">{formatDate(photo.taken_at || photo.uploaded_at)}</span>
                        </div>
                      </div>

                      {/* Tags */}
                      {photo.analysis?.tags && photo.analysis.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {photo.analysis.tags.slice(0, 3).map((tag, idx) => (
                            <span
                              key={idx}
                              className="text-xs font-semibold bg-gradient-to-r from-blue-100 to-purple-100 text-blue-700 px-3 py-1 rounded-full border border-blue-200/50"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* View details hint */}
                      <div className="mt-3 text-center">
                        <span className="text-xs font-medium text-blue-600 group-hover:text-blue-700">
                          Clicca per vedere i dettagli →
                        </span>
                      </div>
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
