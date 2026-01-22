import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { photosApi } from '../api/client';
import Layout from '../components/Layout';
import PhotoUpload from '../components/PhotoUpload';
import { Plus, Loader, Image as ImageIcon, Clock, Eye, Calendar } from 'lucide-react';
import type { Photo } from '../types';

type SortOption = 'date' | 'year' | 'month' | 'day';

// Helper to get elapsed time for a photo
const getElapsedTime = (photoId: string): number => {
  const key = `analysis_start_${photoId}`;
  const startTime = localStorage.getItem(key);
  if (!startTime) return 0;
  return Math.floor((Date.now() - parseInt(startTime)) / 1000);
};

// Helper to track analysis start
const trackAnalysisStart = (photoId: string) => {
  const key = `analysis_start_${photoId}`;
  if (!localStorage.getItem(key)) {
    localStorage.setItem(key, Date.now().toString());
  }
};

// Helper to clear analysis tracking
const clearAnalysisTracking = (photoId: string) => {
  const key = `analysis_start_${photoId}`;
  localStorage.removeItem(key);
};

export default function GalleryPage() {
  const [showUpload, setShowUpload] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('date');
  const [elapsedTimes, setElapsedTimes] = useState<Record<string, number>>({});

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['photos'],
    queryFn: () => photosApi.getPhotos({ limit: 100 }),
    refetchInterval: (query) => {
      // Auto-refresh if any photo is being analyzed
      const photos = query.state.data?.photos || [];
      const hasAnalyzing = photos.some(p => !p.analyzed_at);
      return hasAnalyzing ? 3000 : false; // Refresh every 3s if analyzing
    },
  });

  const photos = data?.photos || [];

  // Track analysis times
  useEffect(() => {
    if (photos.length === 0) return;

    // Mark photos being analyzed
    photos.forEach(photo => {
      if (!photo.analyzed_at) {
        trackAnalysisStart(photo.id);
      } else {
        clearAnalysisTracking(photo.id);
      }
    });

    // Update elapsed times every second
    const interval = setInterval(() => {
      const times: Record<string, number> = {};
      photos.forEach(photo => {
        if (!photo.analyzed_at) {
          times[photo.id] = getElapsedTime(photo.id);
        }
      });
      setElapsedTimes(times);
    }, 1000);

    return () => clearInterval(interval);
  }, [photos]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffSecs < 60) return 'pochi secondi fa';
    if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? 'minuto' : 'minuti'} fa`;
    if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'ora' : 'ore'} fa`;
    if (diffDays < 30) return `${diffDays} ${diffDays === 1 ? 'giorno' : 'giorni'} fa`;
    if (diffMonths < 12) return `${diffMonths} ${diffMonths === 1 ? 'mese' : 'mesi'} fa`;
    return `${diffYears} ${diffYears === 1 ? 'anno' : 'anni'} fa`;
  };

  // Group photos based on sort option
  const groupedPhotos = useMemo(() => {
    if (photos.length === 0) return {};

    const groups: Record<string, Photo[]> = {};

    photos.forEach((photo) => {
      const date = new Date(photo.taken_at || photo.uploaded_at);
      let key: string;

      switch (sortBy) {
        case 'year':
          key = date.getFullYear().toString();
          break;
        case 'month':
          key = date.toLocaleDateString('it-IT', { year: 'numeric', month: 'long' });
          break;
        case 'day':
          key = date.toLocaleDateString('it-IT', { year: 'numeric', month: 'long', day: 'numeric' });
          break;
        default: // 'date'
          key = 'Tutte le foto';
      }

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(photo);
    });

    // Sort each group by date (newest first)
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => {
        const dateA = new Date(a.taken_at || a.uploaded_at);
        const dateB = new Date(b.taken_at || b.uploaded_at);
        return dateB.getTime() - dateA.getTime();
      });
    });

    return groups;
  }, [photos, sortBy]);

  const groupKeys = Object.keys(groupedPhotos).sort((a, b) => {
    if (sortBy === 'date') return 0;
    // Sort groups in descending order (newest first)
    return b.localeCompare(a, 'it');
  });

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">La tua Galleria</h1>
            <p className="text-gray-600 mt-1">
              {photos.length} {photos.length === 1 ? 'foto' : 'foto'}
            </p>
          </div>
          <div className="flex items-center space-x-4">
            {/* Sort Options */}
            <div className="flex items-center space-x-2 bg-white rounded-lg border border-gray-200 p-1">
              <Calendar className="w-4 h-4 text-gray-500 ml-2" />
              <button
                onClick={() => setSortBy('date')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  sortBy === 'date'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                Data
              </button>
              <button
                onClick={() => setSortBy('day')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  sortBy === 'day'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                Giorno
              </button>
              <button
                onClick={() => setSortBy('month')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  sortBy === 'month'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                Mese
              </button>
              <button
                onClick={() => setSortBy('year')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  sortBy === 'year'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                Anno
              </button>
            </div>
            <button
              onClick={() => setShowUpload(!showUpload)}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              <span>Carica Foto</span>
            </button>
          </div>
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

        {/* Photo Grid with Groups */}
        {!isLoading && photos.length > 0 && (
          <div className="space-y-8">
            {groupKeys.map((groupKey) => (
              <div key={groupKey}>
                {sortBy !== 'date' && (
                  <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center space-x-2">
                    <Calendar className="w-6 h-6 text-blue-600" />
                    <span>{groupKey}</span>
                    <span className="text-sm font-normal text-gray-500">
                      ({groupedPhotos[groupKey].length} {groupedPhotos[groupKey].length === 1 ? 'foto' : 'foto'})
                    </span>
                  </h2>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {groupedPhotos[groupKey].map((photo: Photo) => (
                    <Link
                      key={photo.id}
                      to={`/photos/${photo.id}`}
                      className="group relative bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-200"
                    >
                      {/* Photo Image */}
                      <div className="aspect-square bg-gray-100 overflow-hidden">
                        <img
                          src={photosApi.getThumbnailUrl(photo.id, 512)}
                          alt={photo.analysis?.description_short || 'Photo'}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                          loading="lazy"
                        />
                      </div>

                      {/* Overlay with Info */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
                          {photo.analysis?.description_short && (
                            <p className="text-sm font-medium mb-2 line-clamp-2">
                              {photo.analysis.description_short}
                            </p>
                          )}
                          <div className="space-y-1 text-xs">
                            <div className="flex items-center space-x-1">
                              <Clock className="w-3 h-3" />
                              <span>{formatRelativeTime(photo.taken_at || photo.uploaded_at)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-white/70">{formatDate(photo.uploaded_at)}</span>
                              {photo.analyzed_at && (
                                <div className="flex items-center space-x-1">
                                  <Eye className="w-3 h-3" />
                                  <span>Analizzata</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Analysis Status Badge */}
                      {!photo.analyzed_at && (
                        <div className="absolute top-2 right-2">
                          <div className="bg-yellow-500 text-white text-xs font-medium px-2 py-1 rounded-full flex items-center space-x-1">
                            <Loader className="w-3 h-3 animate-spin" />
                            <span>
                              {elapsedTimes[photo.id] > 0
                                ? `${Math.floor(elapsedTimes[photo.id] / 60)}:${String(elapsedTimes[photo.id] % 60).padStart(2, '0')}`
                                : 'Analisi...'}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Tags Preview */}
                      {photo.analysis?.tags && photo.analysis.tags.length > 0 && (
                        <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                          {photo.analysis.tags.slice(0, 2).map((tag, idx) => (
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
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
