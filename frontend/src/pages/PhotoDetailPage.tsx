import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { photosApi, facesApi } from '../api/client';
import apiClient from '../api/client';
import Layout from '../components/Layout';
import PhotoMap from '../components/PhotoMap';
import FaceOverlay from '../components/FaceOverlay';
import type { Face, Person } from '../types';
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
  Edit3,
  MapPin,
  CheckCircle,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';

// Helper to get CSS class for image orientation from EXIF
const getOrientationClass = (orientation?: number) => {
  switch (orientation) {
    case 3: return 'rotate-180';
    case 6: return 'rotate-90';
    case 8: return '-rotate-90';
    default: return '';
  }
};

export default function PhotoDetailPage() {
  const { photoId } = useParams<{ photoId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showModelDialog, setShowModelDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedFace, setSelectedFace] = useState<Face | null>(null);
  const [showFaceLabelDialog, setShowFaceLabelDialog] = useState(false);
  const [labelPersonName, setLabelPersonName] = useState('');
  const [labelPersonId, setLabelPersonId] = useState<string>('');

  // Fetch all persons for labeling dropdown
  const { data: persons = [] } = useQuery({
    queryKey: ['persons'],
    queryFn: () => facesApi.listPersons(),
  });

  const { data: photo, isLoading } = useQuery({
    queryKey: ['photo', photoId],
    queryFn: () => photosApi.getPhoto(photoId!),
    enabled: !!photoId,
    refetchInterval: (query) => {
      // Auto-refresh during LLM analysis or face detection
      const photo = query.state.data;
      const llmInProgress = photo && !photo.analyzed_at && photo.analysis_started_at;
      const faceInProgress = photo?.face_detection_status === 'processing' || photo?.face_detection_status === 'pending';
      return (llmInProgress || faceInProgress) ? 1000 : false;
    },
  });

  const { data: profile } = useQuery({
    queryKey: ['user', 'profile'],
    queryFn: async () => {
      const response = await apiClient.get('/api/user/profile');
      return response.data;
    },
  });

  const formatElapsedTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

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
      toast.success('Rianalisi avviata!');
      setShowModelDialog(false);
      // Invalidate immediately to trigger refetch and show progress
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
      queryClient.invalidateQueries({ queryKey: ['photos'] }); // Also invalidate gallery
    },
    onError: () => {
      toast.error('Errore nell\'avvio della rianalisi');
      setShowModelDialog(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { taken_at?: string; latitude?: number; longitude?: number; location_name?: string }) =>
      photosApi.updatePhoto(photoId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
      toast.success('Foto aggiornata con successo');
      setShowEditDialog(false);
    },
    onError: () => {
      toast.error('Errore nell\'aggiornamento della foto');
    },
  });

  const labelFaceMutation = useMutation({
    mutationFn: (data: { faceId: string; personId?: string; personName?: string }) =>
      facesApi.labelFace(data.faceId, {
        person_id: data.personId,
        person_name: data.personName,
      }),
    onSuccess: () => {
      toast.success('Volto etichettato con successo');
      setShowFaceLabelDialog(false);
      setSelectedFace(null);
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
      queryClient.invalidateQueries({ queryKey: ['persons'] });
    },
    onError: () => {
      toast.error('Errore nell\'etichettatura del volto');
    },
  });

  const redetectFacesMutation = useMutation({
    mutationFn: () => facesApi.detectFaces(photoId!),
    onSuccess: () => {
      toast.success('Rilevamento volti completato');
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.detail || 'Errore nel rilevamento volti';
      toast.error(msg);
    },
  });

  const handleRedetectFaces = () => {
    // Avvisa se ci sono volti etichettati (labels verranno persi)
    const hasLabeledFaces = photo?.has_faces && photo?.face_detection_status === 'completed';
    if (hasLabeledFaces) {
      if (!window.confirm('La ri-analisi eliminerà i volti rilevati in precedenza e i nomi assegnati. Continuare?')) return;
    }
    redetectFacesMutation.mutate();
  };

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

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }) + ', ' + date.toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const EditPhotoDialog = () => {
    const [formData, setFormData] = useState({
      taken_at: photo?.taken_at ? new Date(photo.taken_at).toISOString().slice(0, 16) : '',
      latitude: photo?.latitude?.toString() || '',
      longitude: photo?.longitude?.toString() || '',
      location_name: photo?.location_name || '',
    });

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl max-w-2xl w-full shadow-2xl">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 rounded-t-xl">
            <div className="flex justify-between items-center">
              <div className="flex items-center space-x-3">
                <Edit3 className="w-6 h-6 text-white" />
                <h3 className="text-xl font-bold text-white">Modifica Metadati Foto</h3>
              </div>
              <button
                onClick={() => setShowEditDialog(false)}
                className="text-white hover:bg-white/20 rounded-lg p-1 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const updateData: any = {};
                if (formData.taken_at) updateData.taken_at = new Date(formData.taken_at).toISOString();
                if (formData.latitude) updateData.latitude = parseFloat(formData.latitude);
                if (formData.longitude) updateData.longitude = parseFloat(formData.longitude);
                if (formData.location_name) updateData.location_name = formData.location_name;
                updateMutation.mutate(updateData);
              }}
              className="space-y-5"
            >
              {/* Date and Time */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <label className="block text-sm font-semibold mb-3 flex items-center space-x-2 text-gray-700">
                  <Clock className="w-5 h-5 text-blue-600" />
                  <span>Data e Ora Scatto</span>
                </label>
                <input
                  type="datetime-local"
                  value={formData.taken_at}
                  onChange={(e) => setFormData({ ...formData, taken_at: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                />
                <p className="mt-2 text-xs text-gray-500">
                  Modifica la data e l'ora in cui è stata scattata la foto
                </p>
              </div>

              {/* Location */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <label className="block text-sm font-semibold mb-3 flex items-center space-x-2 text-gray-700">
                  <MapPin className="w-5 h-5 text-green-600" />
                  <span>Località</span>
                </label>
                <input
                  type="text"
                  value={formData.location_name}
                  onChange={(e) => setFormData({ ...formData, location_name: e.target.value })}
                  placeholder="Es: Roma, Colosseo, Italia"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="mt-2 text-xs text-gray-500">
                  Nome del luogo dove è stata scattata la foto
                </p>
              </div>

              {/* GPS Coordinates */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <label className="block text-sm font-semibold mb-3 flex items-center space-x-2 text-gray-700">
                  <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>Coordinate GPS</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Latitudine</label>
                    <input
                      type="number"
                      step="any"
                      value={formData.latitude}
                      onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                      placeholder="41.9028"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Longitudine</label>
                    <input
                      type="number"
                      step="any"
                      value={formData.longitude}
                      onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                      placeholder="12.4964"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Coordinate geografiche precise del luogo (formato decimale)
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditDialog(false)}
                  className="flex-1 px-6 py-3 border-2 border-gray-300 rounded-lg hover:bg-gray-50 font-semibold text-gray-700 transition-colors"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold shadow-lg hover:shadow-xl transition-all flex items-center justify-center space-x-2"
                >
                  {updateMutation.isPending ? (
                    <>
                      <Loader className="w-5 h-5 animate-spin" />
                      <span>Salvataggio...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      <span>Salva Modifiche</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  };

  // FaceLabelDialog è reso inline (non come componente nested) per evitare
  // il problema di focus loss: un componente nested viene ricreato ad ogni
  // re-render del parent, causando unmount/remount e perdita del focus sull'input.

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
            onClick={() => reanalyzeMutation.mutate('moondream')}
            disabled={reanalyzeMutation.isPending}
            className="w-full p-4 text-left border-2 border-green-200 rounded-lg hover:border-green-400 hover:bg-green-50 transition-colors disabled:opacity-50"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <Zap className="w-5 h-5 text-green-600" />
                <span className="font-semibold text-gray-900">Moondream</span>
              </div>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Super Veloce</span>
            </div>
            <p className="text-sm text-gray-600">Modello ultraleggero (1.7GB) - Analisi in ~10 secondi</p>
          </button>

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
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">Veloce</span>
            </div>
            <p className="text-sm text-gray-600">Modello veloce (3.8GB) - Analisi in ~30 secondi</p>
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
            <p className="text-sm text-gray-600">Modello avanzato (11B) - Analisi in ~10 minuti, massima qualità</p>
          </button>

          <button
            onClick={() => reanalyzeMutation.mutate('qwen3-vl:latest')}
            disabled={reanalyzeMutation.isPending}
            className="w-full p-4 text-left border-2 border-indigo-200 rounded-lg hover:border-indigo-400 hover:bg-indigo-50 transition-colors disabled:opacity-50"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <span className="font-semibold text-gray-900">Qwen3-VL</span>
              </div>
              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full">Multilingua</span>
            </div>
            <p className="text-sm text-gray-600">Modello avanzato multilingua (4GB) - Analisi in ~1 minuto</p>
          </button>

          <button
            onClick={() => reanalyzeMutation.mutate('llava:latest')}
            disabled={reanalyzeMutation.isPending}
            className="w-full p-4 text-left border-2 border-cyan-200 rounded-lg hover:border-cyan-400 hover:bg-cyan-50 transition-colors disabled:opacity-50"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-cyan-600" />
                <span className="font-semibold text-gray-900">LLaVA</span>
              </div>
              <span className="text-xs bg-cyan-100 text-cyan-700 px-2 py-1 rounded-full">Preciso</span>
            </div>
            <p className="text-sm text-gray-600">Modello versatile e preciso (4.5GB) - Analisi in ~45 secondi</p>
          </button>

          {/* Remote Server Option */}
          {profile?.remote_ollama_enabled && (
            <button
              onClick={() => reanalyzeMutation.mutate('remote')}
              disabled={reanalyzeMutation.isPending}
              className="w-full p-4 text-left border-2 border-purple-200 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-colors disabled:opacity-50"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <Zap className="w-5 h-5 text-purple-600" />
                  <span className="font-semibold text-gray-900">Server Remoto</span>
                </div>
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">Velocissimo</span>
              </div>
              <p className="text-sm text-gray-600">
                Usa il tuo PC locale ({profile.remote_ollama_model}) - Analisi ultra-rapida
              </p>
            </button>
          )}
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

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowEditDialog(true)}
              className="flex items-center space-x-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <Edit3 className="w-5 h-5" />
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

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Photo */}
          <div className="lg:col-span-3 bg-white rounded-xl overflow-hidden shadow-lg border border-gray-200 animate-fade-in">
            <div className="relative w-full">
              {photo.face_detection_status === 'completed' ? (
                <FaceOverlay
                  photoId={photo.id}
                  imageUrl={photosApi.getPhotoUrl(photo.id)}
                  onFaceClick={(face) => {
                    setSelectedFace(face);
                    setLabelPersonId(face.person_id || '');
                    setLabelPersonName('');
                    setShowFaceLabelDialog(true);
                  }}
                  showLabels={true}
                  className={getOrientationClass(photo.exif_data?.Orientation)}
                  refreshTrigger={photo.faces_detected_at}
                />
              ) : (
                <img
                  src={photosApi.getPhotoUrl(photo.id)}
                  alt={photo.analysis?.description_short || 'Photo'}
                  className={`w-full h-auto object-contain max-h-[80vh] ${getOrientationClass(photo.exif_data?.Orientation)}`}
                />
              )}
            </div>
          </div>

          {/* Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Analysis Status */}
            {!photo.analyzed_at && photo.analysis_started_at ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Loader className="w-6 h-6 text-yellow-600 animate-spin" />
                    <div>
                      <h3 className="font-semibold text-yellow-900">Analisi in corso</h3>
                      <p className="text-sm text-yellow-700">
                        L'AI sta analizzando questa foto...
                      </p>
                    </div>
                  </div>
                  {photo.elapsed_time_seconds && photo.elapsed_time_seconds > 0 && (
                    <div className="text-right">
                      <div className="text-2xl font-bold text-yellow-900">{formatElapsedTime(photo.elapsed_time_seconds)}</div>
                      <div className="text-xs text-yellow-700">tempo trascorso</div>
                    </div>
                  )}
                </div>
              </div>
            ) : !photo.analyzed_at && !photo.analysis_started_at ? (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Eye className="w-6 h-6 text-gray-400" />
                    <div>
                      <h3 className="font-semibold text-gray-900">Non analizzata</h3>
                      <p className="text-sm text-gray-600">
                        Questa foto non è ancora stata analizzata dall'AI
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleReanalyze}
                    disabled={reanalyzeMutation.isPending}
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    title="Analizza con AI"
                  >
                    <Sparkles className={`w-4 h-4 ${reanalyzeMutation.isPending ? 'animate-spin' : ''}`} />
                    <span>{reanalyzeMutation.isPending ? 'Avviando...' : 'Analizza'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-xl p-6 animate-fade-in">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <Sparkles className="w-6 h-6 text-green-600" />
                    <div>
                      <h3 className="font-semibold text-green-900">Analisi completata</h3>
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="bg-white/50 rounded-lg p-3">
                    <div className="text-green-600 font-medium mb-1">Modello AI</div>
                    <div className="text-green-900 font-mono text-xs">{photo.analysis?.model_version || 'N/A'}</div>
                  </div>
                  <div className="bg-white/50 rounded-lg p-3">
                    <div className="text-green-600 font-medium mb-1">Data Analisi</div>
                    <div className="text-green-900">{photo.analyzed_at ? formatDateTime(photo.analyzed_at) : 'N/A'}</div>
                  </div>
                  <div className="bg-white/50 rounded-lg p-3">
                    <div className="text-green-600 font-medium mb-1">Tempo Elaborazione</div>
                    <div className="text-green-900">{photo.analysis?.processing_time_ms ? (photo.analysis.processing_time_ms / 1000).toFixed(1) : '0'}s</div>
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            {photo.analysis?.description_full && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in">
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
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in">
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
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in">
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
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in">
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
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in">
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

            {/* Face Detection */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  <h3 className="font-semibold text-gray-900">Riconoscimento Volti</h3>
                </div>
                <button
                  onClick={handleRedetectFaces}
                  disabled={redetectFacesMutation.isPending}
                  className="flex items-center space-x-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors text-sm font-medium"
                  title="Rianalizza solo i volti (senza rianalisi AI)"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${redetectFacesMutation.isPending ? 'animate-spin' : ''}`} />
                  <span>{redetectFacesMutation.isPending ? 'In corso...' : 'Rianalizza'}</span>
                </button>
              </div>
              <div className="flex items-center space-x-3 text-sm">
                {/* Status badge */}
                {photo.face_detection_status === 'completed' && (
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                    Completato
                  </span>
                )}
                {photo.face_detection_status === 'no_faces' && (
                  <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                    Nessun volto
                  </span>
                )}
                {photo.face_detection_status === 'pending' && (
                  <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
                    In attesa
                  </span>
                )}
                {photo.face_detection_status === 'processing' && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                    In elaborazione...
                  </span>
                )}
                {photo.face_detection_status === 'failed' && (
                  <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                    Fallito
                  </span>
                )}
                {(!photo.face_detection_status || photo.face_detection_status === 'skipped') && (
                  <span className="px-2 py-1 bg-gray-100 text-gray-500 rounded-full text-xs font-medium">
                    Non eseguito
                  </span>
                )}
                {/* Faces count - solo quando completato (dato reale dal pipeline) */}
                {photo.face_detection_status === 'completed' && photo.analysis?.detected_faces !== undefined && photo.analysis.detected_faces > 0 && (
                  <span className="text-gray-600">
                    {photo.analysis.detected_faces} {photo.analysis.detected_faces === 1 ? 'volto rilevato' : 'volti rilevati'}
                  </span>
                )}
              </div>
            </div>

            {/* EXIF Metadata */}
            {photo.exif_data && Object.keys(photo.exif_data).length > 0 && (() => {
              // Organize EXIF data into categories
              const cameraData: [string, any][] = [];
              const exposureData: [string, any][] = [];
              const imageData: [string, any][] = [];
              const otherData: [string, any][] = [];

              const cameraKeys = ['Make', 'Model', 'LensModel', 'LensMake'];
              const exposureKeys = ['ExposureTime', 'FNumber', 'ISO', 'ISOSpeedRatings', 'FocalLength',
                                   'ExposureMode', 'WhiteBalance', 'Flash', 'MeteringMode', 'ExposureProgram'];
              const imageKeys = ['Width', 'Height', 'Orientation', 'ColorSpace', 'ResolutionUnit',
                                'XResolution', 'YResolution'];

              Object.entries(photo.exif_data).forEach(([key, value]) => {
                if (cameraKeys.includes(key)) {
                  cameraData.push([key, value]);
                } else if (exposureKeys.includes(key)) {
                  exposureData.push([key, value]);
                } else if (imageKeys.includes(key)) {
                  imageData.push([key, value]);
                } else {
                  otherData.push([key, value]);
                }
              });

              return (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2">
                      <Camera className="w-5 h-5 text-gray-600" />
                      <h3 className="font-semibold text-gray-900">Metadati Fotocamera</h3>
                    </div>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                      {Object.keys(photo.exif_data).length} campi
                    </span>
                  </div>

                  <div className="space-y-4">
                    {/* Camera Info */}
                    {cameraData.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                          📷 Fotocamera
                        </h4>
                        <div className="grid grid-cols-1 gap-2">
                          {cameraData.map(([key, value]) => (
                            <div key={key} className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
                              <span className="text-xs text-gray-600">{key}</span>
                              <span className="text-sm font-medium text-gray-900">{String(value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Exposure Info */}
                    {exposureData.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                          ⚙️ Esposizione
                        </h4>
                        <div className="grid grid-cols-1 gap-2">
                          {exposureData.map(([key, value]) => (
                            <div key={key} className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
                              <span className="text-xs text-gray-600">{key}</span>
                              <span className="text-sm font-medium text-gray-900 font-mono">{String(value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Image Info */}
                    {imageData.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                          🖼️ Immagine
                        </h4>
                        <div className="grid grid-cols-1 gap-2">
                          {imageData.map(([key, value]) => (
                            <div key={key} className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
                              <span className="text-xs text-gray-600">{key}</span>
                              <span className="text-sm font-medium text-gray-900">{String(value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Other Info */}
                    {otherData.length > 0 && (
                      <details className="group">
                        <summary className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide cursor-pointer hover:text-blue-600 transition-colors">
                          ⚡ Altri Dati ({otherData.length})
                        </summary>
                        <div className="grid grid-cols-1 gap-2 mt-2">
                          {otherData.map(([key, value]) => (
                            <div key={key} className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
                              <span className="text-xs text-gray-600">{key}</span>
                              <span className="text-xs text-gray-900 font-mono max-w-[60%] truncate" title={String(value)}>
                                {String(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Metadata */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in">
              <div className="flex items-center space-x-2 mb-3">
                <Calendar className="w-5 h-5 text-gray-600" />
                <h3 className="font-semibold text-gray-900">Informazioni</h3>
              </div>
              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4" />
                  <span>Scattata: {formatDate(photo.taken_at || photo.uploaded_at)}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4" />
                  <span>Caricata: {formatDate(photo.uploaded_at)}</span>
                </div>
                {photo.location_name && (
                  <div className="flex items-center space-x-2">
                    <MapPin className="w-4 h-4" />
                    <span>{photo.location_name}</span>
                  </div>
                )}
                {photo.latitude && photo.longitude && (
                  <div className="text-xs text-gray-500">
                    GPS: {photo.latitude.toFixed(6)}, {photo.longitude.toFixed(6)}
                  </div>
                )}
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

          {/* Map Section */}
          {photo.latitude && photo.longitude && (
            <PhotoMap
              latitude={photo.latitude}
              longitude={photo.longitude}
              locationName={photo.location_name}
              takenAt={photo.taken_at || photo.uploaded_at}
            />
          )}
        </div>

        {/* Dialogs */}
        {showFaceLabelDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Chi è questa persona?</h3>
                <button onClick={() => setShowFaceLabelDialog(false)}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-gray-600 mb-6">
                {selectedFace?.person_name
                  ? `Attualmente etichettato come: ${selectedFace.person_name}`
                  : 'Questo volto non è ancora stato identificato'}
              </p>

              <div className="space-y-4">
                {persons.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Seleziona persona esistente
                    </label>
                    <select
                      value={labelPersonId}
                      onChange={(e) => {
                        setLabelPersonId(e.target.value);
                        setLabelPersonName('');
                      }}
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Seleziona --</option>
                      {persons.map((person: Person) => (
                        <option key={person.id} value={person.id}>
                          {person.name || `Person ${person.id.slice(0, 8)}`} ({person.photo_count} foto)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {persons.length > 0 && (
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-300" />
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="px-2 bg-white text-gray-500">OPPURE</span>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nome nuova persona
                  </label>
                  <input
                    type="text"
                    value={labelPersonName}
                    onChange={(e) => {
                      setLabelPersonName(e.target.value);
                      setLabelPersonId('');
                    }}
                    placeholder="Es: Mario Rossi"
                    autoFocus
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <button
                  onClick={() => {
                    if (!selectedFace) return;
                    if (!labelPersonId && !labelPersonName.trim()) {
                      toast.error('Seleziona una persona o inserisci un nome');
                      return;
                    }
                    labelFaceMutation.mutate({
                      faceId: selectedFace.id,
                      personId: labelPersonId || undefined,
                      personName: labelPersonName.trim() || undefined,
                    });
                  }}
                  disabled={labelFaceMutation.isPending || (!labelPersonId && !labelPersonName.trim())}
                  className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-colors"
                >
                  {labelFaceMutation.isPending ? 'Salvataggio...' : 'Salva Etichetta'}
                </button>
              </div>
            </div>
          </div>
        )}
        {showModelDialog && <ModelSelectionDialog />}
        {showEditDialog && <EditPhotoDialog />}
      </div>
    </Layout>
  );
}
