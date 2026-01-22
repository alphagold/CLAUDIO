import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { albumsApi, photosApi } from '../api/client';
import Layout from '../components/Layout';
import {
  ArrowLeft,
  Loader,
  Trash2,
  Edit2,
  Plus,
  X,
  Image as ImageIcon,
} from 'lucide-react';
import type { Photo } from '../types';

export default function AlbumDetailPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showEditModal, setShowEditModal] = useState(false);
  const [albumName, setAlbumName] = useState('');
  const [albumDescription, setAlbumDescription] = useState('');

  const { data: album, isLoading: albumLoading } = useQuery({
    queryKey: ['album', albumId],
    queryFn: () => albumsApi.getAlbum(albumId!),
    enabled: !!albumId,
  });

  const { data: photos, isLoading: photosLoading } = useQuery({
    queryKey: ['album-photos', albumId],
    queryFn: () => albumsApi.getAlbumPhotos(albumId!),
    enabled: !!albumId,
  });

  const deleteMutation = useMutation({
    mutationFn: () => albumsApi.deleteAlbum(albumId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['albums'] });
      navigate('/albums');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      albumsApi.updateAlbum(albumId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['album', albumId] });
      setShowEditModal(false);
    },
  });

  const removePhotoMutation = useMutation({
    mutationFn: (photoId: string) => albumsApi.removePhotoFromAlbum(albumId!, photoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['album-photos', albumId] });
    },
  });

  const handleDelete = () => {
    if (window.confirm('Sei sicuro di voler eliminare questo album?')) {
      deleteMutation.mutate();
    }
  };

  const handleEdit = () => {
    if (album) {
      setAlbumName(album.name);
      setAlbumDescription(album.description || '');
      setShowEditModal(true);
    }
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      name: albumName,
      description: albumDescription || undefined,
    });
  };

  const handleRemovePhoto = (photoId: string) => {
    if (window.confirm('Rimuovere questa foto dall\'album?')) {
      removePhotoMutation.mutate(photoId);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  if (albumLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-screen">
          <Loader className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!album) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-4 py-8">
          <p className="text-center text-gray-600">Album non trovato</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate('/albums')}
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">Torna agli Album</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleEdit}
              className="flex items-center space-x-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <Edit2 className="w-5 h-5" />
              <span className="font-medium">Modifica</span>
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="flex items-center space-x-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 className="w-5 h-5" />
              <span className="font-medium">Elimina</span>
            </button>
          </div>
        </div>

        {/* Album Info */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{album.name}</h1>
          {album.description && (
            <p className="text-gray-600 mb-4">{album.description}</p>
          )}
          <div className="flex items-center text-sm text-gray-500 space-x-4">
            <div className="flex items-center space-x-1">
              <ImageIcon className="w-4 h-4" />
              <span>{photos?.length || 0} foto</span>
            </div>
            <div>Creato: {formatDate(album.created_at)}</div>
          </div>
        </div>

        {/* Loading Photos */}
        {photosLoading && (
          <div className="flex items-center justify-center h-64">
            <Loader className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
        )}

        {/* Empty State */}
        {!photosLoading && (!photos || photos.length === 0) && (
          <div className="text-center py-16">
            <div className="bg-gray-100 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6">
              <ImageIcon className="w-12 h-12 text-gray-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Album vuoto</h2>
            <p className="text-gray-600 mb-8">
              Aggiungi foto a questo album dalla galleria
            </p>
            <Link
              to="/gallery"
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors inline-flex items-center space-x-2"
            >
              <Plus className="w-5 h-5" />
              <span>Vai alla Galleria</span>
            </Link>
          </div>
        )}

        {/* Photos Grid */}
        {!photosLoading && photos && photos.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {photos.map((photo: Photo) => (
              <div
                key={photo.id}
                className="group relative bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-200"
              >
                {/* Photo Image */}
                <Link to={`/photos/${photo.id}`}>
                  <div className="aspect-square bg-gray-100 overflow-hidden">
                    <img
                      src={photosApi.getThumbnailUrl(photo.id, 512)}
                      alt={photo.analysis?.description_short || 'Photo'}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                      loading="lazy"
                    />
                  </div>
                </Link>

                {/* Remove Button */}
                <button
                  onClick={() => handleRemovePhoto(photo.id)}
                  className="absolute top-2 right-2 p-2 bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Overlay with Info */}
                <Link to={`/photos/${photo.id}`}>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
                      {photo.analysis?.description_short && (
                        <p className="text-sm font-medium mb-2 line-clamp-2">
                          {photo.analysis?.description_short}
                        </p>
                      )}
                      <div className="text-xs">
                        {formatDate(photo.uploaded_at)}
                      </div>
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}

        {/* Edit Modal */}
        {showEditModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Modifica Album</h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleUpdate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nome Album
                  </label>
                  <input
                    type="text"
                    required
                    value={albumName}
                    onChange={(e) => setAlbumName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Descrizione
                  </label>
                  <textarea
                    value={albumDescription}
                    onChange={(e) => setAlbumDescription(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-none"
                  />
                </div>

                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
                  >
                    Annulla
                  </button>
                  <button
                    type="submit"
                    disabled={updateMutation.isPending}
                    className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
                  >
                    {updateMutation.isPending ? 'Salvataggio...' : 'Salva'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
