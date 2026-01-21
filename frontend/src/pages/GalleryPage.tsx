import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { photosApi } from '../api/client';
import Layout from '../components/Layout';
import PhotoUpload from '../components/PhotoUpload';
import { Plus, Loader, Image as ImageIcon, Clock, Eye } from 'lucide-react';
import type { Photo } from '../types';

export default function GalleryPage() {
  const [showUpload, setShowUpload] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['photos'],
    queryFn: () => photosApi.getPhotos({ limit: 100 }),
  });

  const photos = data?.photos || [];

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">La tua Galleria</h1>
            <p className="text-gray-600 mt-1">
              {photos.length} {photos.length === 1 ? 'foto' : 'foto'}
            </p>
          </div>
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span>Carica Foto</span>
          </button>
        </div>

        {/* Upload Section */}
        {showUpload && (
          <div className="mb-8">
            <PhotoUpload
              onUploadComplete={() => {
                refetch();
                setShowUpload(false);
              }}
            />
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center h-64">
            <Loader className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
        )}

        {/* Empty State */}
        {!isLoading && photos.length === 0 && (
          <div className="text-center py-16">
            <div className="bg-gray-100 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6">
              <ImageIcon className="w-12 h-12 text-gray-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Nessuna foto</h2>
            <p className="text-gray-600 mb-8">
              Inizia caricando la tua prima foto con AI!
            </p>
            <button
              onClick={() => setShowUpload(true)}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors inline-flex items-center space-x-2"
            >
              <Plus className="w-5 h-5" />
              <span>Carica Prima Foto</span>
            </button>
          </div>
        )}

        {/* Photo Grid */}
        {!isLoading && photos.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {photos.map((photo: Photo) => (
              <Link
                key={photo.id}
                to={`/photos/${photo.id}`}
                className="group relative bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-200"
              >
                {/* Photo Image */}
                <div className="aspect-square bg-gray-100 overflow-hidden">
                  <img
                    src={photosApi.getThumbnailUrl(photo.id, 512)}
                    alt={photo.description_short || 'Photo'}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                    loading="lazy"
                  />
                </div>

                {/* Overlay with Info */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
                    {photo.description_short && (
                      <p className="text-sm font-medium mb-2 line-clamp-2">
                        {photo.description_short}
                      </p>
                    )}
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-1">
                        <Clock className="w-3 h-3" />
                        <span>{formatDate(photo.uploaded_at)}</span>
                      </div>
                      {photo.analyzed_at && (
                        <div className="flex items-center space-x-1">
                          <Eye className="w-3 h-3" />
                          <span>Analizzata</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Analysis Status Badge */}
                {!photo.analyzed_at && (
                  <div className="absolute top-2 right-2">
                    <div className="bg-yellow-500 text-white text-xs font-medium px-2 py-1 rounded-full flex items-center space-x-1">
                      <Loader className="w-3 h-3 animate-spin" />
                      <span>Analisi...</span>
                    </div>
                  </div>
                )}

                {/* Tags Preview */}
                {photo.tags && photo.tags.length > 0 && (
                  <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                    {photo.tags.slice(0, 2).map((tag, idx) => (
                      <span
                        key={idx}
                        className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
