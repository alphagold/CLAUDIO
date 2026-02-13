import { useState, useEffect } from 'react';
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
  Sparkles,
  RefreshCw,
  X,
  Camera,
  Edit3,
  MapPin,
  CheckCircle,
  Users,
  UserPlus,
  Pencil,
  Maximize2,
  ChevronRight,
  Info,
  Image as ImageIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function PhotoDetailPage() {
  const { photoId } = useParams<{ photoId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showModelDialog, setShowModelDialog] = useState(false);
  const [reanalyzeStep, setReanalyzeStep] = useState<'model' | 'prompt'>('model');
  const [selectedModel, setSelectedModel] = useState('');
  const [editablePrompt, setEditablePrompt] = useState('');
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedFace, setSelectedFace] = useState<Face | null>(null);
  const [showFaceLabelDialog, setShowFaceLabelDialog] = useState(false);
  const [labelPersonName, setLabelPersonName] = useState('');
  const [labelPersonId, setLabelPersonId] = useState<string>('');
  const [isDrawingFace, setIsDrawingFace] = useState(false);
  const [manualBbox, setManualBbox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [faceRefreshKey, setFaceRefreshKey] = useState(0);
  const [showLightbox, setShowLightbox] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'info' | 'faces'>('info');

  // Reset scroll all'apertura
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [photoId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showLightbox) setShowLightbox(false);
        else if (showFaceLabelDialog) setShowFaceLabelDialog(false);
        else if (showModelDialog) setShowModelDialog(false);
        else if (showEditDialog) setShowEditDialog(false);
      }
      if (e.key === 'i' && !showFaceLabelDialog && !showEditDialog && !showModelDialog) {
        setSidebarOpen(p => !p);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showLightbox, showFaceLabelDialog, showModelDialog, showEditDialog]);

  const { data: persons = [] } = useQuery({
    queryKey: ['persons'],
    queryFn: () => facesApi.listPersons(),
  });

  const { data: photoFaces = [] } = useQuery({
    queryKey: ['photoFaces', photoId, faceRefreshKey],
    queryFn: () => facesApi.getPhotoFaces(photoId!),
    enabled: !!photoId,
  });

  const { data: photo, isLoading } = useQuery({
    queryKey: ['photo', photoId],
    queryFn: () => photosApi.getPhoto(photoId!),
    enabled: !!photoId,
    refetchInterval: (query) => {
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
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const deleteMutation = useMutation({
    mutationFn: () => photosApi.deletePhoto(photoId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      toast.success('Foto eliminata');
      navigate('/gallery');
    },
  });

  const reanalyzeMutation = useMutation({
    mutationFn: ({ model, customPrompt }: { model: string; customPrompt?: string }) =>
      photosApi.reanalyzePhoto(photoId!, model, customPrompt),
    onSuccess: () => {
      toast.success('Rianalisi avviata');
      setShowModelDialog(false);
      setReanalyzeStep('model');
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
    },
    onError: () => toast.error('Errore rianalisi'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: { taken_at?: string; latitude?: number; longitude?: number; location_name?: string }) =>
      photosApi.updatePhoto(photoId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
      toast.success('Foto aggiornata');
      setShowEditDialog(false);
    },
    onError: () => toast.error('Errore aggiornamento'),
  });

  const labelFaceMutation = useMutation({
    mutationFn: (data: { faceId: string; personId?: string; personName?: string }) =>
      facesApi.labelFace(data.faceId, {
        person_id: data.personId,
        person_name: data.personName,
      }),
    onSuccess: () => {
      toast.success('Volto etichettato');
      setShowFaceLabelDialog(false);
      setSelectedFace(null);
      setFaceRefreshKey(k => k + 1);
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
      queryClient.invalidateQueries({ queryKey: ['persons'] });
    },
    onError: () => toast.error('Errore etichettatura'),
  });

  const addManualFaceMutation = useMutation({
    mutationFn: (data: { bbox: { x: number; y: number; width: number; height: number }; personId?: string; personName?: string }) =>
      facesApi.addManualFace(photoId!, {
        bbox_x: data.bbox.x,
        bbox_y: data.bbox.y,
        bbox_width: data.bbox.width,
        bbox_height: data.bbox.height,
        person_id: data.personId,
        person_name: data.personName,
      }),
    onSuccess: () => {
      toast.success('Volto aggiunto');
      setShowFaceLabelDialog(false);
      setManualBbox(null);
      setIsDrawingFace(false);
      setFaceRefreshKey(k => k + 1);
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
      queryClient.invalidateQueries({ queryKey: ['persons'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.detail || 'Errore aggiunta volto'),
  });

  const deleteFaceMutation = useMutation({
    mutationFn: (faceId: string) => facesApi.deleteFace(faceId),
    onSuccess: () => {
      toast.success('Volto rimosso');
      setFaceRefreshKey(k => k + 1);
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
      queryClient.invalidateQueries({ queryKey: ['persons'] });
    },
    onError: () => toast.error('Errore rimozione volto'),
  });

  const redetectFacesMutation = useMutation({
    mutationFn: () => facesApi.detectFaces(photoId!),
    onSuccess: () => {
      toast.success('Rilevamento volti completato');
      setFaceRefreshKey(k => k + 1);
      queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.detail || 'Errore rilevamento volti'),
  });

  const handleSelectModel = async (model: string) => {
    setSelectedModel(model);
    setIsLoadingPrompt(true);
    setReanalyzeStep('prompt');
    try {
      const preview = await photosApi.getPromptPreview(photoId!, model);
      setEditablePrompt(preview.prompt);
    } catch {
      setEditablePrompt('');
      toast.error('Errore caricamento prompt');
    } finally {
      setIsLoadingPrompt(false);
    }
  };

  const handleRedetectFaces = () => {
    if (photo?.face_detection_status === 'completed' && photoFaces.length > 0) {
      if (!window.confirm('Ri-analisi eliminerà i volti esistenti. Continuare?')) return;
    }
    redetectFacesMutation.mutate();
  };

  const handleManualFaceDrawn = (bbox: { x: number; y: number; width: number; height: number }) => {
    setManualBbox(bbox);
    setIsDrawingFace(false);
    setSelectedFace(null);
    setLabelPersonId('');
    setLabelPersonName('');
    setShowFaceLabelDialog(true);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('it-IT', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
      + ', ' + date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <Loader className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!photo) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <p className="text-gray-600">Foto non trovata</p>
        </div>
      </Layout>
    );
  }

  const labeledFaces = photoFaces.filter(f => f.person_name);
  const isAnalyzing = !photo.analyzed_at && photo.analysis_started_at;

  return (
    <Layout>
      <div className="h-[calc(100vh-64px)] flex flex-col bg-gray-950 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 flex-shrink-0 z-10">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => navigate('/gallery')}
              className="flex items-center space-x-1.5 text-gray-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium">Galleria</span>
            </button>

            {/* Analysis status */}
            {isAnalyzing ? (
              <span className="flex items-center space-x-1.5 px-2.5 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-xs font-medium">
                <Loader className="w-3 h-3 animate-spin" />
                <span>Analisi {photo.elapsed_time_seconds ? formatElapsedTime(photo.elapsed_time_seconds) : '...'}</span>
              </span>
            ) : photo.analyzed_at ? (
              <span className="px-2.5 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-medium">
                {photo.analysis?.model_version || 'Analizzata'}
              </span>
            ) : null}
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={() => setShowModelDialog(true)}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              title="Rianalizza con AI"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowEditDialog(true)}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              title="Modifica metadati"
            >
              <Edit3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={`p-2 rounded-lg transition-colors ${sidebarOpen ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
              title="Info e volti (I)"
            >
              <Info className="w-4 h-4" />
            </button>
            <button
              onClick={() => { if (window.confirm('Eliminare questa foto?')) deleteMutation.mutate(); }}
              className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors"
              title="Elimina foto"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Photo area */}
          <div className="flex-1 flex items-center justify-center relative min-w-0 p-4">
            <FaceOverlay
              photoId={photo.id}
              imageUrl={photosApi.getPhotoUrl(photo.id)}
              imageClassName="max-w-full max-h-[calc(100vh-140px)] block"
              onFaceClick={(face) => {
                if (isDrawingFace) return;
                setSelectedFace(face);
                setManualBbox(null);
                setLabelPersonId(face.person_id || '');
                setLabelPersonName('');
                setShowFaceLabelDialog(true);
              }}
              showLabels={true}
              className="cursor-pointer"
              refreshTrigger={`${photo.faces_detected_at}_${faceRefreshKey}`}
              drawMode={isDrawingFace}
              onManualFaceDrawn={handleManualFaceDrawn}
            />

            {/* Click to enlarge hint */}
            {!isDrawingFace && (
              <button
                onClick={() => setShowLightbox(true)}
                className="absolute bottom-6 right-6 bg-black/60 hover:bg-black/80 text-white text-xs px-3 py-1.5 rounded-full flex items-center space-x-1.5 transition-colors backdrop-blur-sm"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Ingrandisci</span>
              </button>
            )}
          </div>

          {/* Sidebar */}
          {sidebarOpen && (
            <div className="w-80 bg-white flex flex-col overflow-hidden flex-shrink-0 shadow-xl">
              {/* Tabs */}
              <div className="flex border-b border-gray-200 flex-shrink-0">
                <button
                  onClick={() => setActiveTab('info')}
                  className={`flex-1 flex items-center justify-center space-x-1.5 px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === 'info'
                      ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Info className="w-4 h-4" />
                  <span>Info</span>
                </button>
                <button
                  onClick={() => setActiveTab('faces')}
                  className={`flex-1 flex items-center justify-center space-x-1.5 px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === 'faces'
                      ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  <span>Volti</span>
                  {photoFaces.length > 0 && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                      {photoFaces.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Sidebar content */}
              <div className="flex-1 overflow-y-auto">
                {activeTab === 'info' && (
                  <div className="divide-y divide-gray-100">
                    {/* Metadati principali */}
                    <div className="p-4 space-y-3">
                      <div className="flex items-start space-x-3">
                        <Calendar className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm text-gray-900">{formatDate(photo.taken_at || photo.uploaded_at)}</div>
                          <div className="text-xs text-gray-400">Data scatto</div>
                        </div>
                      </div>
                      {photo.location_name && (
                        <div className="flex items-start space-x-3">
                          <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="text-sm text-gray-900">{photo.location_name}</div>
                            <div className="text-xs text-gray-400">Luogo</div>
                          </div>
                        </div>
                      )}
                      <div className="flex items-start space-x-3">
                        <Camera className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm text-gray-900">
                            {photo.width && photo.height ? `${photo.width} x ${photo.height}` : 'N/A'}
                            {photo.file_size ? ` — ${(photo.file_size / 1024 / 1024).toFixed(1)} MB` : ''}
                          </div>
                          <div className="text-xs text-gray-400">Dimensioni</div>
                        </div>
                      </div>
                    </div>

                    {/* Tags */}
                    {photo.analysis?.tags && photo.analysis.tags.length > 0 && (
                      <div className="p-4">
                        <div className="flex items-center space-x-1.5 mb-2">
                          <Tag className="w-3.5 h-3.5 text-blue-500" />
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tag</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {photo.analysis.tags.map((tag, idx) => (
                            <span key={idx} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Descrizione AI */}
                    {photo.analysis?.description_full && (
                      <div className="p-4">
                        <div className="flex items-center space-x-1.5 mb-2">
                          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Descrizione AI</span>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed">{photo.analysis.description_full}</p>
                      </div>
                    )}

                    {/* Oggetti */}
                    {photo.analysis?.detected_objects && photo.analysis.detected_objects.length > 0 && (
                      <div className="p-4">
                        <div className="flex items-center space-x-1.5 mb-2">
                          <Eye className="w-3.5 h-3.5 text-purple-500" />
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Oggetti</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {photo.analysis.detected_objects.map((obj, idx) => (
                            <span key={idx} className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full text-xs font-medium">{obj}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Testo estratto */}
                    {photo.analysis?.extracted_text && (
                      <div className="p-4">
                        <div className="flex items-center space-x-1.5 mb-2">
                          <FileText className="w-3.5 h-3.5 text-orange-500" />
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Testo</span>
                        </div>
                        <p className="text-sm text-gray-700 font-mono bg-gray-50 p-3 rounded-lg border border-gray-100">{photo.analysis.extracted_text}</p>
                      </div>
                    )}

                    {/* Categoria scena */}
                    {photo.analysis?.scene_category && (
                      <div className="p-4">
                        <div className="flex items-center space-x-1.5 mb-2">
                          <ImageIcon className="w-3.5 h-3.5 text-indigo-500" />
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Scena</span>
                        </div>
                        <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium">
                          {photo.analysis.scene_category}
                          {photo.analysis.scene_subcategory ? ` / ${photo.analysis.scene_subcategory}` : ''}
                        </span>
                      </div>
                    )}

                    {/* Mappa */}
                    {photo.latitude && photo.longitude && (
                      <div className="p-4">
                        <div className="flex items-center space-x-1.5 mb-2">
                          <MapPin className="w-3.5 h-3.5 text-green-500" />
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Mappa</span>
                        </div>
                        <div className="rounded-lg overflow-hidden border border-gray-200">
                          <PhotoMap
                            latitude={photo.latitude}
                            longitude={photo.longitude}
                            locationName={photo.location_name}
                            takenAt={photo.taken_at || photo.uploaded_at}
                          />
                        </div>
                      </div>
                    )}

                    {/* EXIF */}
                    {photo.exif_data && Object.keys(photo.exif_data).length > 0 && (
                      <div className="p-4">
                        <details>
                          <summary className="flex items-center space-x-1.5 cursor-pointer text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700">
                            <ChevronRight className="w-3.5 h-3.5 transition-transform details-open:rotate-90" />
                            <span>EXIF ({Object.keys(photo.exif_data).length} campi)</span>
                          </summary>
                          <div className="mt-3 space-y-1.5 max-h-60 overflow-y-auto">
                            {Object.entries(photo.exif_data).map(([key, value]) => (
                              <div key={key} className="flex justify-between text-xs gap-2">
                                <span className="text-gray-400 flex-shrink-0">{key}</span>
                                <span className="text-gray-700 font-mono truncate text-right" title={String(value)}>{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    )}

                    {/* Prompt utilizzato */}
                    {photo.analysis?.prompt_used && (
                      <div className="p-4">
                        <details>
                          <summary className="flex items-center space-x-1.5 cursor-pointer text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700">
                            <ChevronRight className="w-3.5 h-3.5 transition-transform details-open:rotate-90" />
                            <span>Prompt utilizzato</span>
                          </summary>
                          <pre className="mt-3 text-xs text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100 whitespace-pre-wrap max-h-60 overflow-y-auto font-mono">{photo.analysis.prompt_used}</pre>
                        </details>
                      </div>
                    )}

                    {/* Risposta raw LLM */}
                    {photo.analysis?.raw_response && (
                      <div className="p-4">
                        <details>
                          <summary className="flex items-center space-x-1.5 cursor-pointer text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700">
                            <ChevronRight className="w-3.5 h-3.5 transition-transform details-open:rotate-90" />
                            <span>Risposta raw LLM</span>
                          </summary>
                          <pre className="mt-3 text-xs text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100 whitespace-pre-wrap max-h-60 overflow-y-auto font-mono">{photo.analysis.raw_response}</pre>
                        </details>
                      </div>
                    )}

                    {/* Analisi meta */}
                    {photo.analyzed_at && (
                      <div className="p-4 text-xs text-gray-400 space-y-1">
                        <div>Analizzata il {formatDateTime(photo.analyzed_at)}</div>
                        {photo.analysis?.processing_time_ms && (
                          <div>Tempo elaborazione: {(photo.analysis.processing_time_ms / 1000).toFixed(1)}s</div>
                        )}
                        {photo.analysis_duration_seconds && (
                          <div>Durata totale: {formatElapsedTime(photo.analysis_duration_seconds)}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'faces' && (
                  <div>
                    {/* Face actions */}
                    <div className="flex items-center justify-between p-4 border-b border-gray-100">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-gray-700">
                          {photoFaces.length > 0
                            ? `${labeledFaces.length} di ${photoFaces.length} identificati`
                            : 'Nessun volto'}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => setIsDrawingFace(!isDrawingFace)}
                          className={`p-1.5 rounded-lg text-sm transition-colors ${
                            isDrawingFace ? 'bg-green-600 text-white shadow-sm' : 'text-green-600 hover:bg-green-50'
                          }`}
                          title="Aggiungi volto manualmente"
                        >
                          <UserPlus className="w-4 h-4" />
                        </button>
                        <button
                          onClick={handleRedetectFaces}
                          disabled={redetectFacesMutation.isPending}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-50 transition-colors"
                          title="Rileva volti"
                        >
                          <RefreshCw className={`w-4 h-4 ${redetectFacesMutation.isPending ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                    </div>

                    {/* Detection status */}
                    {photo.face_detection_status === 'processing' && (
                      <div className="flex items-center space-x-2 px-4 py-3 bg-blue-50 text-blue-600 text-sm">
                        <Loader className="w-4 h-4 animate-spin" />
                        <span>Rilevamento in corso...</span>
                      </div>
                    )}

                    {/* Face list */}
                    {photoFaces.length > 0 ? (
                      <div className="divide-y divide-gray-50">
                        {photoFaces.map((face) => (
                          <div
                            key={face.id}
                            className="flex items-center px-4 py-3 hover:bg-gray-50 transition-colors group"
                          >
                            {/* Face thumbnail */}
                            <div
                              className="w-10 h-10 rounded-lg overflow-hidden border border-gray-200 bg-gray-100 flex-shrink-0 mr-3"
                              style={(() => {
                                if (!photo.width || !photo.height || !face.bbox.width || !face.bbox.height) {
                                  return { backgroundImage: `url(${photosApi.getThumbnailUrl(photo.id, 512)})`, backgroundSize: 'cover', backgroundPosition: 'center' };
                                }
                                const containerSize = 40;
                                const scaleX = containerSize / face.bbox.width;
                                const scaleY = containerSize / face.bbox.height;
                                const scale = Math.max(scaleX, scaleY);
                                const bgW = photo.width * scale;
                                const bgH = photo.height * scale;
                                const centerX = face.bbox.x + face.bbox.width / 2;
                                const centerY = face.bbox.y + face.bbox.height / 2;
                                const posX = -(centerX * scale - containerSize / 2);
                                const posY = -(centerY * scale - containerSize / 2);
                                return {
                                  backgroundImage: `url(${photosApi.getThumbnailUrl(photo.id, 512)})`,
                                  backgroundSize: `${bgW}px ${bgH}px`,
                                  backgroundPosition: `${posX}px ${posY}px`,
                                };
                              })()}
                            />

                            {/* Name */}
                            <div
                              className="flex-1 min-w-0 cursor-pointer"
                              onClick={() => {
                                setSelectedFace(face);
                                setManualBbox(null);
                                setLabelPersonId(face.person_id || '');
                                setLabelPersonName('');
                                setShowFaceLabelDialog(true);
                              }}
                            >
                              <div className={`text-sm font-medium truncate ${face.person_name ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                                {face.person_name || 'Sconosciuto'}
                              </div>
                              <div className="text-xs text-gray-400">
                                {face.quality_score ? `${Math.round(face.quality_score * 100)}%` : ''}
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                              <button
                                onClick={() => {
                                  setSelectedFace(face);
                                  setManualBbox(null);
                                  setLabelPersonId(face.person_id || '');
                                  setLabelPersonName('');
                                  setShowFaceLabelDialog(true);
                                }}
                                className="p-1 text-blue-500 hover:bg-blue-50 rounded"
                                title="Etichetta"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  if (window.confirm('Rimuovere questo volto?')) {
                                    deleteFaceMutation.mutate(face.id);
                                  }
                                }}
                                disabled={deleteFaceMutation.isPending}
                                className="p-1 text-red-400 hover:bg-red-50 rounded"
                                title="Rimuovi volto"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-8 text-center text-gray-400">
                        <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">
                          {photo.face_detection_status === 'no_faces' ? 'Nessun volto rilevato' :
                           photo.face_detection_status === 'pending' ? 'In attesa di analisi' :
                           photo.face_detection_status === 'failed' ? 'Rilevamento fallito' :
                           'Premi il pulsante "+" per aggiungere manualmente'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox fullscreen */}
      {showLightbox && (
        <div
          className="fixed inset-0 bg-black z-50 flex items-center justify-center"
          onClick={() => setShowLightbox(false)}
        >
          <button
            className="absolute top-4 right-4 text-white/60 hover:text-white z-10 p-2 rounded-full hover:bg-white/10 transition-colors"
            onClick={() => setShowLightbox(false)}
          >
            <X className="w-8 h-8" />
          </button>
          <img
            src={photosApi.getPhotoUrl(photo.id)}
            alt="Fullscreen"
            className="max-w-[95vw] max-h-[95vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Face Label Dialog */}
      {showFaceLabelDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <Users className="w-5 h-5 text-white" />
                  <h3 className="text-lg font-bold text-white">
                    {manualBbox ? 'Nuovo Volto' : 'Chi è?'}
                  </h3>
                </div>
                <button
                  onClick={() => { setShowFaceLabelDialog(false); setManualBbox(null); setSelectedFace(null); }}
                  className="text-white/70 hover:text-white hover:bg-white/20 rounded-lg p-1 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5">
              {selectedFace?.person_name && !manualBbox && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                  Attuale: <strong>{selectedFace.person_name}</strong>
                </div>
              )}

              <div className="space-y-4">
                {persons.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Persona esistente</label>
                    <select
                      value={labelPersonId}
                      onChange={(e) => { setLabelPersonId(e.target.value); setLabelPersonName(''); }}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                    >
                      <option value="">-- Seleziona --</option>
                      {persons.map((person: Person) => (
                        <option key={person.id} value={person.id}>
                          {person.name || `Person ${person.id.slice(0, 8)}`} ({person.photo_count})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {persons.length > 0 && (
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
                    <div className="relative flex justify-center text-xs"><span className="px-3 bg-white text-gray-400 font-medium">oppure</span></div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Nuova persona</label>
                  <input
                    type="text"
                    value={labelPersonName}
                    onChange={(e) => { setLabelPersonName(e.target.value); setLabelPersonId(''); }}
                    placeholder="Es: Mario Rossi"
                    autoFocus
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (labelPersonId || labelPersonName.trim())) {
                        e.preventDefault();
                        if (manualBbox) {
                          addManualFaceMutation.mutate({ bbox: manualBbox, personId: labelPersonId || undefined, personName: labelPersonName.trim() || undefined });
                        } else if (selectedFace) {
                          labelFaceMutation.mutate({ faceId: selectedFace.id, personId: labelPersonId || undefined, personName: labelPersonName.trim() || undefined });
                        }
                      }
                    }}
                  />
                </div>

                <div className="flex space-x-2 pt-2">
                  <button
                    onClick={() => { setShowFaceLabelDialog(false); setManualBbox(null); setSelectedFace(null); }}
                    className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors"
                  >
                    Annulla
                  </button>
                  {manualBbox && (
                    <button
                      onClick={() => addManualFaceMutation.mutate({ bbox: manualBbox })}
                      disabled={addManualFaceMutation.isPending}
                      className="px-4 py-2.5 border border-green-300 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-50 text-sm font-medium transition-colors"
                    >
                      Solo Volto
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (!labelPersonId && !labelPersonName.trim()) { toast.error('Seleziona o inserisci un nome'); return; }
                      if (manualBbox) {
                        addManualFaceMutation.mutate({ bbox: manualBbox, personId: labelPersonId || undefined, personName: labelPersonName.trim() || undefined });
                      } else if (selectedFace) {
                        labelFaceMutation.mutate({ faceId: selectedFace.id, personId: labelPersonId || undefined, personName: labelPersonName.trim() || undefined });
                      }
                    }}
                    disabled={(labelFaceMutation.isPending || addManualFaceMutation.isPending) || (!labelPersonId && !labelPersonName.trim())}
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center space-x-1.5 transition-colors"
                  >
                    {(labelFaceMutation.isPending || addManualFaceMutation.isPending) ? (
                      <Loader className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        <span>Salva</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reanalyze Dialog (2-step: model → prompt) */}
      {showModelDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  {reanalyzeStep === 'prompt' && (
                    <button
                      onClick={() => setReanalyzeStep('model')}
                      className="text-white/70 hover:text-white rounded-lg p-1"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                  )}
                  <h3 className="text-lg font-bold text-white">
                    {reanalyzeStep === 'model' ? 'Scegli Modello AI' : 'Modifica Prompt'}
                  </h3>
                </div>
                <button onClick={() => { setShowModelDialog(false); setReanalyzeStep('model'); }} className="text-white/70 hover:text-white rounded-lg p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {reanalyzeStep === 'prompt' && (
                <div className="text-xs text-white/60 mt-1">
                  Modello: {selectedModel}
                </div>
              )}
            </div>

            {reanalyzeStep === 'model' && (
              <div className="p-4 space-y-2">
                {[
                  { id: 'moondream', name: 'Moondream', desc: '1.7GB — ~10s', speed: 'Veloce' },
                  { id: 'llava-phi3', name: 'LLaVA-Phi3', desc: '3.8GB — ~30s', speed: 'Medio' },
                  { id: 'qwen3-vl:latest', name: 'Qwen3-VL', desc: '4GB — ~1min', speed: 'Italiano' },
                  { id: 'llava:latest', name: 'LLaVA', desc: '4.5GB — ~45s', speed: 'Medio' },
                  { id: 'llama3.2-vision', name: 'Llama 3.2 Vision', desc: '11B — ~10min', speed: 'Preciso' },
                ].map(m => (
                  <button
                    key={m.id}
                    onClick={() => handleSelectModel(m.id)}
                    className="w-full p-3 text-left border border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50/50 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-gray-900 text-sm">{m.name}</span>
                        <span className="text-xs text-gray-400 ml-2">{m.desc}</span>
                      </div>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{m.speed}</span>
                    </div>
                  </button>
                ))}
                {profile?.remote_ollama_enabled && (
                  <button
                    onClick={() => handleSelectModel('remote')}
                    className="w-full p-3 text-left border border-purple-200 rounded-xl hover:border-purple-400 hover:bg-purple-50/50 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-gray-900 text-sm">Server Remoto</span>
                        <span className="text-xs text-gray-400 ml-2">{profile.remote_ollama_model}</span>
                      </div>
                      <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">Remoto</span>
                    </div>
                  </button>
                )}
              </div>
            )}

            {reanalyzeStep === 'prompt' && (
              <div className="p-4 space-y-3">
                {isLoadingPrompt ? (
                  <div className="flex items-center justify-center py-8 space-x-2 text-gray-500">
                    <Loader className="w-5 h-5 animate-spin" />
                    <span className="text-sm">Caricamento prompt...</span>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                        Prompt (editabile)
                      </label>
                      <textarea
                        value={editablePrompt}
                        onChange={(e) => setEditablePrompt(e.target.value)}
                        rows={12}
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
                      />
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setReanalyzeStep('model')}
                        className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors"
                      >
                        Indietro
                      </button>
                      <button
                        onClick={() => reanalyzeMutation.mutate({ model: selectedModel, customPrompt: editablePrompt || undefined })}
                        disabled={reanalyzeMutation.isPending || !editablePrompt.trim()}
                        className="flex-1 px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center space-x-1.5 transition-colors"
                      >
                        {reanalyzeMutation.isPending ? (
                          <Loader className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            <span>Analizza</span>
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Photo Dialog */}
      {showEditDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-4 flex justify-between items-center">
              <div className="flex items-center space-x-2">
                <Edit3 className="w-5 h-5 text-white" />
                <h3 className="text-lg font-bold text-white">Modifica Metadati</h3>
              </div>
              <button onClick={() => setShowEditDialog(false)} className="text-white/70 hover:text-white rounded-lg p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <EditPhotoForm
              photo={photo}
              onSubmit={(data) => updateMutation.mutate(data)}
              onCancel={() => setShowEditDialog(false)}
              isPending={updateMutation.isPending}
            />
          </div>
        </div>
      )}
    </Layout>
  );
}

function EditPhotoForm({ photo, onSubmit, onCancel, isPending }: {
  photo: any;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [formData, setFormData] = useState({
    taken_at: photo?.taken_at ? new Date(photo.taken_at).toISOString().slice(0, 16) : '',
    latitude: photo?.latitude?.toString() || '',
    longitude: photo?.longitude?.toString() || '',
    location_name: photo?.location_name || '',
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data: any = {};
        if (formData.taken_at) data.taken_at = new Date(formData.taken_at).toISOString();
        if (formData.latitude) data.latitude = parseFloat(formData.latitude);
        if (formData.longitude) data.longitude = parseFloat(formData.longitude);
        if (formData.location_name) data.location_name = formData.location_name;
        onSubmit(data);
      }}
      className="p-5 space-y-4"
    >
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Data Scatto</label>
        <input
          type="datetime-local"
          value={formData.taken_at}
          onChange={(e) => setFormData({ ...formData, taken_at: e.target.value })}
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Luogo</label>
        <input
          type="text"
          value={formData.location_name}
          onChange={(e) => setFormData({ ...formData, location_name: e.target.value })}
          placeholder="Es: Roma, Colosseo"
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Latitudine</label>
          <input
            type="number"
            step="any"
            value={formData.latitude}
            onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
            placeholder="41.9028"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Longitudine</label>
          <input
            type="number"
            step="any"
            value={formData.longitude}
            onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
            placeholder="12.4964"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div className="flex space-x-3 pt-2">
        <button type="button" onClick={onCancel} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium transition-colors">
          Annulla
        </button>
        <button type="submit" disabled={isPending} className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center space-x-1.5 transition-colors">
          {isPending ? <Loader className="w-4 h-4 animate-spin" /> : <><CheckCircle className="w-4 h-4" /><span>Salva</span></>}
        </button>
      </div>
    </form>
  );
}
