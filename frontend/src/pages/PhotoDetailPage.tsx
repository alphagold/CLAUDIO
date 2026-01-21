import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { photosApi } from '../api/client';
import Layout from '../components/Layout';
import {
  ArrowLeft,
  Loader,
  Calendar,
  Tag,
  Eye,
  FileText,
  Trash2,
  Clock,
  Sparkles,
} from 'lucide-react';

export default function PhotoDetailPage() {
  const { photoId } = useParams<{ photoId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: photo, isLoading } = useQuery({
    queryKey: ['photo', photoId],
    queryFn: () => photosApi.getPhoto(photoId!),
    enabled: !!photoId,
  });

  const deleteMutation = useMutation({
    mutationFn: () => photosApi.deletePhoto(photoId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      navigate('/gallery');
    },
  });

  const handleDelete = () => {
    if (window.confirm('Sei sicuro di voler eliminare questa foto?')) {
      deleteMutation.mutate();
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-screen">
          <Loader className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!photo) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-4 py-8">
          <p className="text-center text-gray-600">Foto non trovata</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/gallery')}
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">Torna alla Galleria</span>
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Photo */}
          <div className="bg-white rounded-xl overflow-hidden shadow-lg border border-gray-200">
            <img
              src={photosApi.getPhotoUrl(photo.id)}
              alt={photo.analysis?.description_short || 'Photo'}
              className="w-full h-auto"
            />
          </div>

          {/* Details */}
          <div className="space-y-6">
            {/* Analysis Status */}
            {!photo.analyzed_at ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
                <div className="flex items-center space-x-3">
                  <Loader className="w-6 h-6 text-yellow-600 animate-spin" />
                  <div>
                    <h3 className="font-semibold text-yellow-900">Analisi in corso</h3>
                    <p className="text-sm text-yellow-700">
                      L'AI sta analizzando questa foto...
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-xl p-6">
                <div className="flex items-center space-x-3">
                  <Sparkles className="w-6 h-6 text-green-600" />
                  <div>
                    <h3 className="font-semibold text-green-900">Analisi completata</h3>
                    <p className="text-sm text-green-700">
                      Modello: {photo.analysis?.model_version} • {photo.analysis?.processing_time_ms}ms
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            {photo.analysis?.description_full && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center space-x-2 mb-3">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <h3 className="font-semibold text-gray-900">Descrizione AI</h3>
                </div>
                <p className="text-gray-700 leading-relaxed">{photo.analysis?.description_full}</p>
                {photo.analysis?.confidence_score && (
                  <div className="mt-4 flex items-center space-x-2 text-sm text-gray-600">
                    <Eye className="w-4 h-4" />
                    <span>Confidence: {(photo.analysis?.confidence_score * 100).toFixed(0)}%</span>
                  </div>
                )}
              </div>
            )}

            {/* Detected Objects */}
            {photo.analysis?.detected_objects && photo.analysis?.detected_objects.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center space-x-2 mb-3">
                  <Eye className="w-5 h-5 text-purple-600" />
                  <h3 className="font-semibold text-gray-900">Oggetti Rilevati</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {photo.analysis?.detected_objects.map((obj, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium"
                    >
                      {obj}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {photo.analysis?.tags && photo.analysis?.tags.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center space-x-2 mb-3">
                  <Tag className="w-5 h-5 text-blue-600" />
                  <h3 className="font-semibold text-gray-900">Tags</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {photo.analysis?.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Extracted Text */}
            {photo.analysis?.extracted_text && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center space-x-2 mb-3">
                  <FileText className="w-5 h-5 text-orange-600" />
                  <h3 className="font-semibold text-gray-900">Testo Estratto</h3>
                </div>
                <p className="text-gray-700 font-mono text-sm bg-gray-50 p-4 rounded-lg">
                  {photo.analysis?.extracted_text}
                </p>
              </div>
            )}

            {/* Scene Category */}
            {photo.analysis?.scene_category && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center space-x-2 mb-3">
                  <Sparkles className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-semibold text-gray-900">Categoria Scena</h3>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-medium">
                    {photo.analysis?.scene_category}
                  </span>
                  {photo.analysis?.scene_subcategory && (
                    <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-sm">
                      {photo.analysis?.scene_subcategory}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center space-x-2 mb-3">
                <Calendar className="w-5 h-5 text-gray-600" />
                <h3 className="font-semibold text-gray-900">Informazioni</h3>
              </div>
              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4" />
                  <span>Caricata: {formatDate(photo.uploaded_at)}</span>
                </div>
                {photo.width && photo.height && (
                  <div>
                    Dimensioni: {photo.width} × {photo.height} px
                  </div>
                )}
                <div>
                  Dimensione: {(photo.file_size / 1024 / 1024).toFixed(2)} MB
                </div>
                <div>Tipo: {photo.mime_type}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
