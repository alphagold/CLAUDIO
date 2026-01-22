import { useState } from 'react';
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
  RefreshCw,
  X,
  Zap,
  Camera,
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function PhotoDetailPage() {
  const { photoId } = useParams<{ photoId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showModelDialog, setShowModelDialog] = useState(false);

  const { data: photo, isLoading } = useQuery({
    queryKey: ['photo', photoId],
    queryFn: () => photosApi.getPhoto(photoId!),
    enabled: !!photoId,
  });

  const deleteMutation = useMutation({
    mutationFn: () => photosApi.deletePhoto(photoId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'status'] });
      toast.success('Foto eliminata con successo');
      navigate('/gallery');
    },
  });

  const reanalyzeMutation = useMutation({
    mutationFn: (model: string) => photosApi.reanalyzePhoto(photoId!, model),
    onSuccess: () => {
      toast.success('Rianalisi avviata! Aggiorna tra qualche secondo.');
      setShowModelDialog(false);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
      }, 3000);
    },
    onError: () => {
      toast.error('Errore nell\'avvio della rianalisi');
      setShowModelDialog(false);
    },
  });

  const handleDelete = () => {
    if (window.confirm('Sei sicuro di voler eliminare questa foto?')) {
      deleteMutation.mutate();
    }
  };

  const handleReanalyze = () => {
    setShowModelDialog(true);
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

  const ModelSelectionDialog = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">Scegli Modello AI</h3>
          <button onClick={() => setShowModelDialog(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-gray-600 mb-6">
          Seleziona il modello da utilizzare per rianalizzare questa foto
        </p>

        <div className="space-y-3">
          <button
            onClick={() => reanalyzeMutation.mutate('llava-phi3')}
            disabled={reanalyzeMutation.isPending}
            className="w-full p-4 text-left border-2 border-blue-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <Zap className="w-5 h-5 text-blue-600" />
                <span className="font-semibold text-gray-900">LLaVA-Phi3</span>
              </div>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Veloce</span>
            </div>
            <p className="text-sm text-gray-600">Modello veloce (3.8B) - Analisi in ~30 secondi</p>
          </button>

          <button
            onClick={() => reanalyzeMutation.mutate('llama3.2-vision')}
            disabled={reanalyzeMutation.isPending}
            className="w-full p-4 text-left border-2 border-purple-200 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-colors disabled:opacity-50"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                <span className="font-semibold text-gray-900">Llama 3.2 Vision</span>
              </div>
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">Dettagliato</span>
            </div>
            <p className="text-sm text-gray-600">Modello avanzato (11B) - Analisi in ~3 minuti, massima qualità</p>
          </button>
        </div>

        {reanalyzeMutation.isPending && (
          <div className="mt-4 flex items-center justify-center space-x-2 text-blue-600">
            <Loader className="w-5 h-5 animate-spin" />
            <span className="text-sm">Avvio rianalisi...</span>
          </div>
        )}
      </div>
    </div>
  );

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
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Sparkles className="w-6 h-6 text-green-600" />
                    <div>
                      <h3 className="font-semibold text-green-900">Analisi completata</h3>
                      <p className="text-sm text-green-700">
                        Modello: {photo.analysis?.model_version} • {photo.analysis?.processing_time_ms}ms
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleReanalyze}
                    disabled={reanalyzeMutation.isPending}
                    className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                    title="Rianalizza con AI dettagliata"
                  >
                    <RefreshCw className={`w-4 h-4 ${reanalyzeMutation.isPending ? 'animate-spin' : ''}`} />
                    <span>{reanalyzeMutation.isPending ? 'Avviando...' : 'Rianalizza'}</span>
                  </button>
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

            {/* EXIF Metadata */}
            {photo.exif_data && Object.keys(photo.exif_data).length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center space-x-2 mb-3">
                  <Camera className="w-5 h-5 text-gray-600" />
                  <h3 className="font-semibold text-gray-900">Dati EXIF</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  {Object.entries(photo.exif_data).map(([key, value]) => (
                    <div key={key} className="flex flex-col">
                      <span className="text-gray-500 text-xs font-medium uppercase">{key.replace(/_/g, ' ')}</span>
                      <span className="text-gray-900 font-mono">{String(value)}</span>
                    </div>
                  ))}
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
                {photo.file_size && (
                  <div>
                    Dimensione: {(photo.file_size / 1024 / 1024).toFixed(2)} MB
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Model Selection Dialog */}
        {showModelDialog && <ModelSelectionDialog />}
      </div>
    </Layout>
  );
}
