import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { photosApi } from '../api/client';
import apiClient from '../api/client';
import Layout from '../components/Layout';
import PhotoUpload from '../components/PhotoUpload';
import { Plus, Loader, Image as ImageIcon, Clock, Eye, Calendar, Search, Filter, CheckSquare, Trash2, X, Grid3x3, Grid2x2, List, LayoutGrid, ChevronDown, ChevronUp, Sparkles, Zap, Users } from 'lucide-react';
import type { Photo } from '../types';
import PhotoSkeleton from '../components/PhotoSkeleton';
import toast from 'react-hot-toast';
import { AnalysisQueueWidget } from '../components/AnalysisQueueWidget';

type SortOption = 'date' | 'year' | 'month' | 'day';
type ViewMode = 'grid-small' | 'grid-large' | 'list' | 'details';

export default function GalleryPage() {
  const queryClient = useQueryClient();
  const [showUpload, setShowUpload] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('date');

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>('grid-large');

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [showBulkAnalyzeDialog, setShowBulkAnalyzeDialog] = useState(false);

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
      const hasAnalyzing = photos.some(p => !p.analyzed_at && p.analysis_started_at);
      return hasAnalyzing ? 1000 : false; // Refresh every 1s if analyzing (più reattivo)
    },
  });

  const photos = data?.photos || [];

  // Fetch all available tags
  const { data: tagsData } = useQuery({
    queryKey: ['tags'],
    queryFn: () => photosApi.getAllTags(),
  });

  const { data: profile } = useQuery({
    queryKey: ['user', 'profile'],
    queryFn: async () => {
      const response = await apiClient.get('/api/user/profile');
      return response.data;
    },
  });

  const availableTags = tagsData?.tags || [];

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

  // Bulk analyze mutation
  const bulkAnalyzeMutation = useMutation({
    mutationFn: (model: string) => photosApi.bulkAnalyzePhotos(Array.from(selectedPhotos), model),
    onSuccess: (data) => {
      toast.success(`Analisi avviata per ${data.queued} foto!`);
      setShowBulkAnalyzeDialog(false);
      setSelectedPhotos(new Set());
      setSelectMode(false);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['photos'] });
      }, 2000);
    },
    onError: () => {
      toast.error('Errore nell\'avvio dell\'analisi multipla');
    },
  });

  // Stop all analyses mutation
  const stopAllMutation = useMutation({
    mutationFn: () => photosApi.stopAllAnalyses(),
    onSuccess: (data) => {
      toast.success(`${data.queue_cleared} analisi fermate!`);
      queryClient.invalidateQueries({ queryKey: ['photos'] });
    },
    onError: () => {
      toast.error('Errore nel fermare le analisi');
    },
  });

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
          className="group relative bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all duration-200 border border-gray-200 flex items-center animate-fade-in"
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
                  {photo.analysis?.description_short || (!photo.analyzed_at && photo.analysis_started_at ? 'Analisi in corso...' : 'Non analizzata')}
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
                    <>
                      <div className="flex items-center space-x-1 text-green-600">
                        <Eye className="w-3 h-3" />
                        <span>Analizzata {formatDate(photo.analyzed_at)}</span>
                      </div>
                      {photo.analysis?.model_version && (
                        <div className="text-gray-400 text-[10px]">
                          {photo.analysis.model_version}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="ml-4 flex flex-col items-end space-y-1">
                {!photo.analyzed_at && photo.analysis_started_at && (
                  <div className="bg-yellow-500 text-white text-xs font-medium px-2 py-1 rounded-full flex items-center space-x-1">
                    <Loader className="w-3 h-3 animate-spin" />
                  </div>
                )}
                {(photo.face_detection_status === 'pending' || photo.face_detection_status === 'processing') && (
                  <div className="bg-blue-500 text-white text-xs font-medium px-2 py-1 rounded-full flex items-center space-x-1">
                    <Loader className="w-3 h-3 animate-spin" />
                    <span>Volti...</span>
                  </div>
                )}
                {photo.face_detection_status === 'completed' && (photo.analysis?.detected_faces ?? 0) > 0 && (
                  <div className="bg-indigo-100 text-indigo-700 text-xs font-medium px-2 py-1 rounded-full flex items-center space-x-1">
                    <Users className="w-3 h-3" />
                    <span>{photo.analysis!.detected_faces}</span>
                  </div>
                )}
              </div>
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
          className="group relative bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 border border-gray-200 animate-fade-in"
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
              {photo.analysis?.description_short || (!photo.analyzed_at && photo.analysis_started_at ? 'Analisi in corso...' : 'Non analizzata')}
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
                <div className="flex flex-col items-end space-y-0.5 text-xs">
                  <div className="flex items-center space-x-1 text-green-600 font-medium">
                    <Eye className="w-3 h-3" />
                    <span>Analizzata</span>
                  </div>
                  <div className="text-gray-500">{formatDate(photo.analyzed_at)}</div>
                  {photo.analysis?.model_version && (
                    <div className="text-gray-400 text-[10px]">{photo.analysis.model_version}</div>
                  )}
                </div>
              ) : photo.analysis_started_at ? (
                <div className="flex items-center space-x-1 text-yellow-600">
                  <Loader className="w-3 h-3 animate-spin" />
                  <span>Analisi...</span>
                </div>
              ) : (
                <div className="flex items-center space-x-1 text-gray-400">
                  <Eye className="w-3 h-3" />
                  <span>Non analizzata</span>
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
            {photos.some(p => !p.analyzed_at && p.analysis_started_at) && (
              <button
                onClick={() => stopAllMutation.mutate()}
                disabled={stopAllMutation.isPending}
                className="flex items-center space-x-2 px-4 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5" />
                <span>Ferma Analisi</span>
              </button>
            )}
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
                <div className="flex space-x-3">
                  <button
                    onClick={() => setShowBulkAnalyzeDialog(true)}
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Analizza</span>
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Elimina</span>
                  </button>
                </div>
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

        {/* Analysis Queue Status Widget - Always visible if active */}
        <AnalysisQueueWidget />

        {/* Loading State */}
        {isLoading && (
          <div className={getGridClasses()}>
            {Array.from({ length: 12 }).map((_, i) => (
              <PhotoSkeleton key={i} viewMode={viewMode} />
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && photos.length === 0 && (
          <div className="text-center py-20">
            <div className="relative w-32 h-32 mx-auto mb-8">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-400 to-purple-500 rounded-3xl transform rotate-6 opacity-20 animate-pulse"></div>
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl flex items-center justify-center">
                <ImageIcon className="w-16 h-16 text-white" />
              </div>
              <div className="absolute -top-2 -right-2 bg-yellow-400 rounded-full p-2 animate-bounce">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">La tua galleria è vuota</h2>
            <p className="text-lg text-gray-600 mb-10 max-w-md mx-auto">
              Carica la tua prima foto e lascia che l'intelligenza artificiale la analizzi automaticamente! ✨
            </p>
            <button
              onClick={() => setShowUpload(true)}
              className="group px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 inline-flex items-center space-x-3"
            >
              <Plus className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" />
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
                        className={`group relative bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border-2 cursor-pointer animate-fade-in ${
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
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-sm">
                          <div className="absolute bottom-0 left-0 right-0 p-4 text-white transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                            {photo.analysis?.description_short && (
                              <p className="text-sm font-semibold mb-2 line-clamp-2 drop-shadow-lg">
                                {photo.analysis.description_short}
                              </p>
                            )}
                            <div className="space-y-1.5 text-xs">
                              <div className="flex items-center space-x-1.5 text-white/90">
                                <Clock className="w-3.5 h-3.5" />
                                <span>{formatRelativeTime(photo.taken_at || photo.uploaded_at)}</span>
                              </div>
                              <div className="flex items-center justify-between text-white/80">
                                <span>{formatDate(photo.uploaded_at)}</span>
                                {photo.analyzed_at && (
                                  <div className="flex flex-col items-end space-y-0.5">
                                    <div className="flex items-center space-x-1 bg-green-500/20 backdrop-blur-sm px-2 py-0.5 rounded-full">
                                      <Eye className="w-3 h-3" />
                                      <span>{formatDate(photo.analyzed_at)}</span>
                                    </div>
                                    {photo.analysis?.model_version && (
                                      <div className="text-white/50 text-[10px] bg-black/20 px-1.5 py-0.5 rounded">
                                        {photo.analysis.model_version}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Analysis Status Badge */}
                        {!photo.analyzed_at && photo.analysis_started_at && (
                          <div className="absolute top-3 right-3">
                            <div className="bg-yellow-500 text-white text-xs font-medium px-2 py-1 rounded-full flex items-center space-x-1">
                              <Loader className="w-3 h-3 animate-spin" />
                              <span>
                                {photo.elapsed_time_seconds && photo.elapsed_time_seconds > 0
                                  ? `${Math.floor(photo.elapsed_time_seconds / 60)}:${String(photo.elapsed_time_seconds % 60).padStart(2, '0')}`
                                  : 'Analisi...'}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Not Analyzed Badge */}
                        {!photo.analyzed_at && !photo.analysis_started_at && (
                          <div className="absolute top-3 right-3">
                            <div className="bg-gray-500 text-white text-xs font-medium px-2 py-1 rounded-full">
                              Da analizzare
                            </div>
                          </div>
                        )}

                        {/* Face Detection Badge */}
                        {(photo.face_detection_status === 'pending' || photo.face_detection_status === 'processing') && (
                          <div className="absolute bottom-2 left-2">
                            <div className="bg-blue-500/90 text-white text-xs font-medium px-2 py-1 rounded-full flex items-center space-x-1">
                              <Loader className="w-3 h-3 animate-spin" />
                              <span>Volti...</span>
                            </div>
                          </div>
                        )}
                        {photo.face_detection_status === 'completed' && (photo.analysis?.detected_faces ?? 0) > 0 && (
                          <div className="absolute bottom-2 left-2">
                            <div className="bg-indigo-600/90 text-white text-xs font-medium px-2 py-1 rounded-full flex items-center space-x-1">
                              <Users className="w-3 h-3" />
                              <span>{photo.analysis!.detected_faces}</span>
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
                        className="group relative bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-2xl transition-all duration-300 border border-gray-200 hover:border-blue-300 transform hover:-translate-y-1 animate-fade-in"
                      >
                        {/* Photo Image */}
                        <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden">
                          <img
                            src={photosApi.getThumbnailUrl(photo.id, 512)}
                            alt={photo.analysis?.description_short || 'Photo'}
                            className="w-full h-full object-cover group-hover:scale-110 transition-all duration-500 ease-out"
                            loading="lazy"
                          />
                        </div>

                        {/* Overlay with Info */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-sm">
                          <div className="absolute bottom-0 left-0 right-0 p-4 text-white transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                            {photo.analysis?.description_short && (
                              <p className="text-sm font-semibold mb-2 line-clamp-2 drop-shadow-lg">
                                {photo.analysis.description_short}
                              </p>
                            )}
                            <div className="space-y-1.5 text-xs">
                              <div className="flex items-center space-x-1.5 text-white/90">
                                <Clock className="w-3.5 h-3.5" />
                                <span>{formatRelativeTime(photo.taken_at || photo.uploaded_at)}</span>
                              </div>
                              <div className="flex items-center justify-between text-white/80">
                                <span>{formatDate(photo.uploaded_at)}</span>
                                {photo.analyzed_at && (
                                  <div className="flex flex-col items-end space-y-0.5">
                                    <div className="flex items-center space-x-1 bg-green-500/20 backdrop-blur-sm px-2 py-0.5 rounded-full">
                                      <Eye className="w-3 h-3" />
                                      <span>{formatDate(photo.analyzed_at)}</span>
                                    </div>
                                    {photo.analysis?.model_version && (
                                      <div className="text-white/50 text-[10px] bg-black/20 px-1.5 py-0.5 rounded">
                                        {photo.analysis.model_version}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Analysis Status Badge */}
                        {!photo.analyzed_at && photo.analysis_started_at && (
                          <div className="absolute top-2 right-2">
                            <div className="bg-yellow-500 text-white text-xs font-medium px-2 py-1 rounded-full flex items-center space-x-1">
                              <Loader className="w-3 h-3 animate-spin" />
                              <span>
                                {photo.elapsed_time_seconds && photo.elapsed_time_seconds > 0
                                  ? `${Math.floor(photo.elapsed_time_seconds / 60)}:${String(photo.elapsed_time_seconds % 60).padStart(2, '0')}`
                                  : 'Analisi...'}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Not Analyzed Badge */}
                        {!photo.analyzed_at && !photo.analysis_started_at && (
                          <div className="absolute top-2 right-2">
                            <div className="bg-gray-500 text-white text-xs font-medium px-2 py-1 rounded-full">
                              Da analizzare
                            </div>
                          </div>
                        )}

                        {/* Face Detection Badge */}
                        {(photo.face_detection_status === 'pending' || photo.face_detection_status === 'processing') && (
                          <div className="absolute bottom-2 left-2">
                            <div className="bg-blue-500/90 text-white text-xs font-medium px-2 py-1 rounded-full flex items-center space-x-1">
                              <Loader className="w-3 h-3 animate-spin" />
                              <span>Volti...</span>
                            </div>
                          </div>
                        )}
                        {photo.face_detection_status === 'completed' && (photo.analysis?.detected_faces ?? 0) > 0 && (
                          <div className="absolute bottom-2 left-2">
                            <div className="bg-indigo-600/90 text-white text-xs font-medium px-2 py-1 rounded-full flex items-center space-x-1">
                              <Users className="w-3 h-3" />
                              <span>{photo.analysis!.detected_faces}</span>
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

      {/* Bulk Analyze Dialog */}
      {showBulkAnalyzeDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Scegli Modello per Analisi</h3>
              <button onClick={() => setShowBulkAnalyzeDialog(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-gray-600 mb-6">
              Seleziona il modello da utilizzare per analizzare {selectedPhotos.size} foto
            </p>

            <div className="space-y-3">
              <button
                onClick={() => bulkAnalyzeMutation.mutate('moondream')}
                disabled={bulkAnalyzeMutation.isPending}
                className="w-full p-4 text-left border-2 border-green-200 rounded-lg hover:border-green-400 hover:bg-green-50 transition-colors disabled:opacity-50"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Zap className="w-5 h-5 text-green-600" />
                    <span className="font-semibold text-gray-900">Moondream</span>
                  </div>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Super Veloce</span>
                </div>
                <p className="text-sm text-gray-600">Modello ultraleggero (1.7GB) - ~10 secondi per foto</p>
              </button>

              <button
                onClick={() => bulkAnalyzeMutation.mutate('llava-phi3')}
                disabled={bulkAnalyzeMutation.isPending}
                className="w-full p-4 text-left border-2 border-blue-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Zap className="w-5 h-5 text-blue-600" />
                    <span className="font-semibold text-gray-900">LLaVA-Phi3</span>
                  </div>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">Veloce</span>
                </div>
                <p className="text-sm text-gray-600">Modello veloce (3.8GB) - ~30 secondi per foto</p>
              </button>

              <button
                onClick={() => bulkAnalyzeMutation.mutate('llama3.2-vision')}
                disabled={bulkAnalyzeMutation.isPending}
                className="w-full p-4 text-left border-2 border-purple-200 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-colors disabled:opacity-50"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Sparkles className="w-5 h-5 text-purple-600" />
                    <span className="font-semibold text-gray-900">Llama 3.2 Vision</span>
                  </div>
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">Dettagliato</span>
                </div>
                <p className="text-sm text-gray-600">Modello avanzato (11GB) - ~10 minuti per foto, massima qualità</p>
              </button>

              <button
                onClick={() => bulkAnalyzeMutation.mutate('qwen3-vl:latest')}
                disabled={bulkAnalyzeMutation.isPending}
                className="w-full p-4 text-left border-2 border-indigo-200 rounded-lg hover:border-indigo-400 hover:bg-indigo-50 transition-colors disabled:opacity-50"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Sparkles className="w-5 h-5 text-indigo-600" />
                    <span className="font-semibold text-gray-900">Qwen3-VL</span>
                  </div>
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full">Multilingua</span>
                </div>
                <p className="text-sm text-gray-600">Modello avanzato multilingua (4GB) - ~1 minuto per foto</p>
              </button>

              <button
                onClick={() => bulkAnalyzeMutation.mutate('llava:latest')}
                disabled={bulkAnalyzeMutation.isPending}
                className="w-full p-4 text-left border-2 border-cyan-200 rounded-lg hover:border-cyan-400 hover:bg-cyan-50 transition-colors disabled:opacity-50"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Sparkles className="w-5 h-5 text-cyan-600" />
                    <span className="font-semibold text-gray-900">LLaVA</span>
                  </div>
                  <span className="text-xs bg-cyan-100 text-cyan-700 px-2 py-1 rounded-full">Preciso</span>
                </div>
                <p className="text-sm text-gray-600">Modello versatile e preciso (4.5GB) - ~45 secondi per foto</p>
              </button>

              {/* Remote Server Option */}
              {profile?.remote_ollama_enabled && (
                <button
                  onClick={() => bulkAnalyzeMutation.mutate('remote')}
                  disabled={bulkAnalyzeMutation.isPending}
                  className="w-full p-4 text-left border-2 border-purple-200 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <Zap className="w-5 h-5 text-purple-600" />
                      <span className="font-semibold text-gray-900">Server Remoto</span>
                    </div>
                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">Velocissimo</span>
                  </div>
                  <p className="text-sm text-gray-600">Usa il tuo PC locale ({profile.remote_ollama_model}) - ~10-30 secondi per foto</p>
                </button>
              )}
            </div>

            {bulkAnalyzeMutation.isPending && (
              <div className="mt-4 flex items-center justify-center space-x-2 text-blue-600">
                <Loader className="w-5 h-5 animate-spin" />
                <span className="text-sm">Avvio analisi...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
