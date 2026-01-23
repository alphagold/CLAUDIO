import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { photosApi } from '../api/client';
import Layout from '../components/Layout';
import PhotoUpload from '../components/PhotoUpload';
import { Plus, Loader, Image as ImageIcon, Clock, Eye, Calendar, Search, Filter, CheckSquare, Trash2, X, Grid3x3, Grid2x2, List, LayoutGrid, ChevronDown, ChevronUp } from 'lucide-react';
import type { Photo } from '../types';

type SortOption = 'date' | 'year' | 'month' | 'day';
type ViewMode = 'grid-small' | 'grid-large' | 'list' | 'details';

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

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>('grid-large');

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('');

  // Tag filter state
  const [showAllTags, setShowAllTags] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['photos', activeQuery, selectedTag],
    queryFn: async () => {
      // If tag filter, search by tag
      if (selectedTag) {
        const searchResults = await photosApi.searchPhotos(selectedTag, 100);
        return { photos: searchResults, total: searchResults.length, skip: 0, limit: 100 };
      }
      // If searching, use search functionality
      if (activeQuery) {
        const searchResults = await photosApi.searchPhotos(activeQuery, 100);
        return { photos: searchResults, total: searchResults.length, skip: 0, limit: 100 };
      }
      // Otherwise get all photos
      return photosApi.getPhotos({ limit: 100 });
    },
    refetchInterval: (query) => {
      // Auto-refresh if any photo is being analyzed
      const photos = query.state.data?.photos || [];
      const hasAnalyzing = photos.some(p => !p.analyzed_at);
      return hasAnalyzing ? 3000 : false; // Refresh every 3s if analyzing
    },
  });

  const photos = data?.photos || [];

  // Fetch all available tags
  const { data: tagsData } = useQuery({
    queryKey: ['tags'],
    queryFn: () => photosApi.getAllTags(),
  });

  const availableTags = tagsData?.tags || [];

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

  // Search handlers
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveQuery(searchQuery);
    setSelectedTag('');
  };

  const handleTagFilter = (tag: string) => {
    setSelectedTag(tag);
    setActiveQuery('');
    setSearchQuery('');
  };

  const clearSearch = () => {
    setActiveQuery('');
    setSelectedTag('');
    setSearchQuery('');
  };

  // Selection handlers
  const toggleSelectMode = () => {
    setSelectMode(!selectMode);
    setSelectedPhotos(new Set());
  };

  const togglePhotoSelection = (photoId: string) => {
    const newSelected = new Set(selectedPhotos);
    if (newSelected.has(photoId)) {
      newSelected.delete(photoId);
    } else {
      newSelected.add(photoId);
    }
    setSelectedPhotos(newSelected);
  };

  const selectAll = () => {
    const allPhotoIds = new Set(photos.map(p => p.id));
    setSelectedPhotos(allPhotoIds);
  };

  const deselectAll = () => {
    setSelectedPhotos(new Set());
  };

  // Bulk delete handler
  const handleBulkDelete = async () => {
    if (selectedPhotos.size === 0) return;

    const confirmMsg = `Vuoi eliminare ${selectedPhotos.size} ${selectedPhotos.size === 1 ? 'foto' : 'foto'}?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await photosApi.bulkDeletePhotos(Array.from(selectedPhotos));
      setSelectedPhotos(new Set());
      setSelectMode(false);
      refetch();
    } catch (error) {
      console.error('Errore durante l\'eliminazione:', error);
      alert('Errore durante l\'eliminazione delle foto');
    }
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

  // Get grid CSS classes based on view mode
  const getGridClasses = () => {
    switch (viewMode) {
      case 'grid-small':
        return 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3';
      case 'grid-large':
        return 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6';
      case 'list':
        return 'flex flex-col space-y-3';
      case 'details':
        return 'grid grid-cols-1 lg:grid-cols-2 gap-4';
      default:
        return 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6';
    }
  };

  // Render photo card based on view mode
  const renderPhotoCard = (photo: Photo) => {
    if (viewMode === 'list') {
      return (
        <Link
          key={photo.id}
          to={`/photos/${photo.id}`}
          className="group relative bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all duration-200 border border-gray-200 flex items-center"
        >
          {/* Thumbnail */}
          <div className="w-32 h-32 flex-shrink-0 bg-gray-100 overflow-hidden">
            <img
              src={photosApi.getThumbnailUrl(photo.id, 128)}
              alt={photo.analysis?.description_short || 'Photo'}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>

          {/* Info */}
          <div className="flex-1 p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="font-semibold text-gray-900 line-clamp-1">
                  {photo.analysis?.description_short || 'Analisi in corso...'}
                </p>
                <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                  {photo.analysis?.description_full || ''}
                </p>
                <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                  <div className="flex items-center space-x-1">
                    <Clock className="w-3 h-3" />
                    <span>{formatRelativeTime(photo.taken_at || photo.uploaded_at)}</span>
                  </div>
                  {photo.analyzed_at && (
                    <div className="flex items-center space-x-1">
                      <Eye className="w-3 h-3" />
                      <span>Analizzata</span>
                    </div>
                  )}
                </div>
              </div>
              {!photo.analyzed_at && (
                <div className="ml-4">
                  <div className="bg-yellow-500 text-white text-xs font-medium px-2 py-1 rounded-full flex items-center space-x-1">
                    <Loader className="w-3 h-3 animate-spin" />
                  </div>
                </div>
              )}
            </div>
            {/* Tags */}
            {photo.analysis?.tags && photo.analysis.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {photo.analysis.tags.slice(0, 5).map((tag, idx) => (
                  <span
                    key={idx}
                    className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Link>
      );
    }

    if (viewMode === 'details') {
      return (
        <Link
          key={photo.id}
          to={`/photos/${photo.id}`}
          className="group relative bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 border border-gray-200"
        >
          {/* Image */}
          <div className="aspect-video bg-gray-100 overflow-hidden">
            <img
              src={photosApi.getThumbnailUrl(photo.id, 512)}
              alt={photo.analysis?.description_short || 'Photo'}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          </div>

          {/* Details */}
          <div className="p-4">
            <h3 className="font-semibold text-gray-900 mb-2 line-clamp-1">
              {photo.analysis?.description_short || 'Analisi in corso...'}
            </h3>
            <p className="text-sm text-gray-600 mb-3 line-clamp-3">
              {photo.analysis?.description_full || ''}
            </p>

            {/* Tags */}
            {photo.analysis?.tags && photo.analysis.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {photo.analysis.tags.map((tag, idx) => (
                  <span
                    key={idx}
                    className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* Metadata */}
            <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-gray-100">
              <div className="flex items-center space-x-1">
                <Clock className="w-3 h-3" />
                <span>{formatRelativeTime(photo.taken_at || photo.uploaded_at)}</span>
              </div>
              {photo.analyzed_at ? (
                <div className="flex items-center space-x-1 text-green-600">
                  <Eye className="w-3 h-3" />
                  <span>Analizzata</span>
                </div>
              ) : (
                <div className="flex items-center space-x-1 text-yellow-600">
                  <Loader className="w-3 h-3 animate-spin" />
                  <span>Analisi...</span>
                </div>
              )}
            </div>
          </div>
        </Link>
      );
    }

    // grid-small or grid-large view
    return null; // Will use existing rendering below
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">La tua Galleria</h1>
            <p className="text-gray-600 mt-1">
              {photos.length} {photos.length === 1 ? 'foto' : 'foto'}
              {(activeQuery || selectedTag) && ' (filtrate)'}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            {/* View Mode Options */}
            <div className="flex items-center space-x-1 bg-white rounded-lg border border-gray-200 p-1">
              <button
                onClick={() => setViewMode('grid-small')}
                className={`p-2 rounded transition-colors ${
                  viewMode === 'grid-small'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                title="Griglia piccola"
              >
                <Grid3x3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('grid-large')}
                className={`p-2 rounded transition-colors ${
                  viewMode === 'grid-large'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                title="Griglia grande"
              >
                <Grid2x2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded transition-colors ${
                  viewMode === 'list'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                title="Lista"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('details')}
                className={`p-2 rounded transition-colors ${
                  viewMode === 'details'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                title="Dettagli"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>

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
              onClick={toggleSelectMode}
              className={`flex items-center space-x-2 px-4 py-3 rounded-lg font-semibold transition-colors ${
                selectMode
                  ? 'bg-gray-600 text-white hover:bg-gray-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {selectMode ? <X className="w-5 h-5" /> : <CheckSquare className="w-5 h-5" />}
              <span>{selectMode ? 'Annulla' : 'Seleziona'}</span>
            </button>
            <button
              onClick={() => setShowUpload(!showUpload)}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              <span>Carica Foto</span>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <form onSubmit={handleSearch} className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cerca 'cibo italiano', 'vacanza in montagna', 'foto con amici'..."
              className="w-full pl-12 pr-24 py-3 text-base border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
            />
            {(activeQuery || selectedTag) && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancella
              </button>
            )}
          </form>
        </div>

        {/* Tag Filters */}
        {availableTags.length > 0 && (
          <div className="mb-6 bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Filter className="w-4 h-4 text-gray-600" />
                <h2 className="text-sm font-semibold text-gray-700">Filtra per Tag ({availableTags.length})</h2>
              </div>
              {availableTags.length > 10 && (
                <button
                  onClick={() => setShowAllTags(!showAllTags)}
                  className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  <span>{showAllTags ? 'Mostra meno' : `Mostra tutti (${availableTags.length})`}</span>
                  {showAllTags ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(showAllTags ? availableTags : availableTags.slice(0, 10)).map((tag) => (
                <button
                  key={tag}
                  onClick={() => handleTagFilter(tag)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    selectedTag === tag
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-white text-gray-700 border border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                >
                  #{tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Bulk Action Toolbar */}
        {selectMode && (
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <span className="text-sm font-semibold text-gray-900">
                  {selectedPhotos.size} {selectedPhotos.size === 1 ? 'foto selezionata' : 'foto selezionate'}
                </span>
                <div className="flex space-x-2">
                  <button
                    onClick={selectAll}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Seleziona tutto
                  </button>
                  {selectedPhotos.size > 0 && (
                    <button
                      onClick={deselectAll}
                      className="text-sm text-gray-600 hover:text-gray-700 font-medium"
                    >
                      Deseleziona tutto
                    </button>
                  )}
                </div>
              </div>
              {selectedPhotos.size > 0 && (
                <button
                  onClick={handleBulkDelete}
                  className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Elimina</span>
                </button>
              )}
            </div>
          </div>
        )}

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
                <div className={getGridClasses()}>
                  {groupedPhotos[groupKey].map((photo: Photo) => {
                    const isSelected = selectedPhotos.has(photo.id);

                    // Use special rendering for list and details views (no select mode)
                    if (!selectMode && (viewMode === 'list' || viewMode === 'details')) {
                      return renderPhotoCard(photo);
                    }

                    return selectMode ? (
                      <div
                        key={photo.id}
                        onClick={() => togglePhotoSelection(photo.id)}
                        className={`group relative bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border-2 cursor-pointer ${
                          isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'
                        }`}
                      >
                        {/* Photo Image */}
                        <div className="aspect-square bg-gray-100 overflow-hidden">
                          <img
                            src={photosApi.getThumbnailUrl(photo.id, 512)}
                            alt={photo.analysis?.description_short || 'Photo'}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>

                        {/* Selection Checkbox */}
                        <div className="absolute top-3 left-3 z-10">
                          <div className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${
                            isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white/90 border-gray-300'
                          } border-2`}>
                            {isSelected && (
                              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
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
                          <div className="absolute top-3 right-3">
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

                        {/* Tags Preview - only if not selected */}
                        {!isSelected && photo.analysis?.tags && photo.analysis.tags.length > 0 && (
                          <div className="absolute top-3 left-3 flex flex-wrap gap-1">
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
                      </div>
                    ) : (
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
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
