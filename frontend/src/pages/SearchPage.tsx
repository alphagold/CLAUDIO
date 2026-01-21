import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { photosApi } from '../api/client';
import Layout from '../components/Layout';
import { Search, Loader, Image as ImageIcon, Filter } from 'lucide-react';
import type { Photo } from '../types';

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  const { data: photos, isLoading, refetch } = useQuery({
    queryKey: ['search', activeQuery, selectedCategory],
    queryFn: async () => {
      if (!activeQuery && !selectedCategory) return [];

      if (selectedCategory) {
        const response = await photosApi.getPhotos({
          scene_category: selectedCategory,
          limit: 100
        });
        return response.photos;
      }

      return photosApi.searchPhotos(activeQuery, 100);
    },
    enabled: !!activeQuery || !!selectedCategory,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveQuery(searchQuery);
    setSelectedCategory('');
  };

  const handleCategoryFilter = (category: string) => {
    setSelectedCategory(category);
    setActiveQuery('');
    setSearchQuery('');
  };

  const categories = [
    { value: 'food', label: 'Cibo', icon: '🍕' },
    { value: 'outdoor', label: 'All\'aperto', icon: '🏞️' },
    { value: 'indoor', label: 'Interni', icon: '🏠' },
    { value: 'people', label: 'Persone', icon: '👥' },
    { value: 'document', label: 'Documenti', icon: '📄' },
    { value: 'receipt', label: 'Scontrini', icon: '🧾' },
  ];

  const popularSearches = [
    'cibo', 'natura', 'amici', 'famiglia', 'viaggio',
    'festa', 'animali', 'montagna', 'mare', 'città'
  ];

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
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Cerca Foto</h1>
          <p className="text-gray-600">
            Cerca le tue foto usando l'intelligenza artificiale
          </p>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="mb-8">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cerca 'cibo italiano', 'vacanza in montagna', 'foto con amici'..."
              className="w-full pl-14 pr-4 py-4 text-lg border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
            />
          </div>
        </form>

        {/* Category Filters */}
        <div className="mb-8">
          <div className="flex items-center space-x-2 mb-4">
            <Filter className="w-5 h-5 text-gray-600" />
            <h2 className="font-semibold text-gray-900">Filtra per Categoria</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {categories.map((category) => (
              <button
                key={category.value}
                onClick={() => handleCategoryFilter(category.value)}
                className={`p-4 rounded-xl border-2 transition-all ${
                  selectedCategory === category.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="text-3xl mb-2">{category.icon}</div>
                <div className="text-sm font-medium text-gray-900">{category.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Popular Searches */}
        {!activeQuery && !selectedCategory && (
          <div className="mb-8">
            <h2 className="font-semibold text-gray-900 mb-4">Ricerche Popolari</h2>
            <div className="flex flex-wrap gap-2">
              {popularSearches.map((term) => (
                <button
                  key={term}
                  onClick={() => {
                    setSearchQuery(term);
                    setActiveQuery(term);
                  }}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center h-64">
            <Loader className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
        )}

        {/* Results */}
        {(activeQuery || selectedCategory) && !isLoading && (
          <>
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900">
                {photos && photos.length > 0 ? (
                  <>
                    {photos.length} {photos.length === 1 ? 'risultato' : 'risultati'}
                    {activeQuery && ` per "${activeQuery}"`}
                    {selectedCategory && ` nella categoria "${categories.find(c => c.value === selectedCategory)?.label}"`}
                  </>
                ) : (
                  <>Nessun risultato trovato</>
                )}
              </h2>
            </div>

            {/* Photo Grid */}
            {photos && photos.length > 0 ? (
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
                        <div className="flex items-center text-xs">
                          <span>{formatDate(photo.uploaded_at)}</span>
                        </div>
                      </div>
                    </div>

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
            ) : (
              <div className="text-center py-16">
                <div className="bg-gray-100 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6">
                  <ImageIcon className="w-12 h-12 text-gray-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  Nessun risultato
                </h3>
                <p className="text-gray-600">
                  Prova con termini di ricerca diversi
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
