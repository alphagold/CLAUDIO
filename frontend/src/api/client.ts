import axios from 'axios';
import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  Photo,
  PhotosResponse,
  PhotoUploadResponse,
  Album,
  CreateAlbumRequest,
  SearchQuery,
  Face,
  Person,
  PersonUpdateRequest,
  FaceLabelRequest,
  SimilarFace,
  Cluster,
  ConsentResponse,
  FaceDetectionResponse,
} from '../types';

// API base URL - change this to your backend URL
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://192.168.200.4:8000';

// Create axios instance
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  console.log('Request config:', {
    url: config.url,
    method: config.method,
    headers: config.headers,
    data: config.data,
  });
  return config;
});

// Log response errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', {
      status: error.response?.status,
      data: error.response?.data,
      config: error.config,
    });
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  login: async (data: LoginRequest): Promise<AuthResponse> => {
    console.log('Login request data:', data);
    const payload = {
      email: data.email,
      password: data.password,
    };
    console.log('Sending payload:', payload);
    const response = await apiClient.post<AuthResponse>('/api/auth/login', payload);
    return response.data;
  },

  register: async (data: RegisterRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/api/auth/register', data);
    return response.data;
  },

  me: async (): Promise<any> => {
    const response = await apiClient.get('/api/auth/me');
    return response.data;
  },
};

// Photos API
export const photosApi = {
  getPhotos: async (params?: SearchQuery): Promise<PhotosResponse> => {
    const response = await apiClient.get<PhotosResponse>('/api/photos', { params });
    return response.data;
  },

  getPhoto: async (photoId: string): Promise<Photo> => {
    const response = await apiClient.get<Photo>(`/api/photos/${photoId}`);
    return response.data;
  },

  uploadPhoto: async (file: File): Promise<PhotoUploadResponse> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.post<PhotoUploadResponse>('/api/photos', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  deletePhoto: async (photoId: string): Promise<void> => {
    await apiClient.delete(`/api/photos/${photoId}`);
  },

  bulkDeletePhotos: async (photoIds: string[]): Promise<void> => {
    await Promise.all(photoIds.map(id => apiClient.delete(`/api/photos/${id}`)));
  },

  reanalyzePhoto: async (photoId: string, model: string = 'llama3.2-vision'): Promise<any> => {
    const response = await apiClient.post(`/api/photos/${photoId}/reanalyze`, null, {
      params: { model },
    });
    return response.data;
  },

  bulkAnalyzePhotos: async (photoIds: string[], model?: string): Promise<any> => {
    const params = model ? { model } : {};
    const response = await apiClient.post('/api/photos/bulk-analyze', photoIds, {
      params,
    });
    return response.data;
  },

  stopAllAnalyses: async (): Promise<any> => {
    const response = await apiClient.post('/api/photos/stop-all-analyses');
    return response.data;
  },

  updatePhoto: async (photoId: string, data: { taken_at?: string; latitude?: number; longitude?: number; location_name?: string }): Promise<Photo> => {
    const response = await apiClient.patch(`/api/photos/${photoId}`, null, {
      params: data,
    });
    return response.data;
  },

  searchPhotos: async (query: string, limit = 100): Promise<Photo[]> => {
    const response = await apiClient.get<PhotosResponse>('/api/photos', {
      params: { q: query, limit },
    });
    return response.data.photos;
  },

  getPhotoUrl: (photoId: string): string => {
    return `${API_BASE_URL}/api/photos/${photoId}/file`;
  },

  getThumbnailUrl: (photoId: string, size: number = 512): string => {
    return `${API_BASE_URL}/api/photos/${photoId}/thumbnail?size=${size}`;
  },

  getAllTags: async (): Promise<{ tags: string[]; count: number }> => {
    const response = await apiClient.get('/api/photos/tags/all');
    return response.data;
  },
};

// Remote Ollama API
export const remoteOllamaApi = {
  fetchModels: async (url: string): Promise<{
    models: Array<{ name: string; size: number; modified_at?: string }>;
    all_models: Array<{ name: string; size: number; modified_at?: string }>;
    vision_only: boolean;
    count: number;
    server_url: string;
  }> => {
    const response = await apiClient.get('/api/admin/ollama/remote/models', {
      params: { url },
    });
    return response.data;
  },

  testConnection: async (url: string): Promise<{ status: string; message: string; url: string }> => {
    const response = await apiClient.get('/api/admin/ollama/remote/test', {
      params: { url },
    });
    return response.data;
  },
};

// Albums API
export const albumsApi = {
  getAlbums: async (): Promise<Album[]> => {
    const response = await apiClient.get<Album[]>('/api/albums');
    return response.data;
  },

  getAlbum: async (albumId: string): Promise<Album> => {
    const response = await apiClient.get<Album>(`/api/albums/${albumId}`);
    return response.data;
  },

  createAlbum: async (data: CreateAlbumRequest): Promise<Album> => {
    const response = await apiClient.post<Album>('/api/albums', data);
    return response.data;
  },

  updateAlbum: async (albumId: string, data: Partial<CreateAlbumRequest>): Promise<Album> => {
    const response = await apiClient.patch<Album>(`/api/albums/${albumId}`, data);
    return response.data;
  },

  deleteAlbum: async (albumId: string): Promise<void> => {
    await apiClient.delete(`/api/albums/${albumId}`);
  },

  getAlbumPhotos: async (albumId: string): Promise<Photo[]> => {
    const response = await apiClient.get<Photo[]>(`/api/albums/${albumId}/photos`);
    return response.data;
  },

  addPhotoToAlbum: async (albumId: string, photoId: string): Promise<void> => {
    await apiClient.post(`/api/albums/${albumId}/photos/${photoId}`);
  },

  removePhotoFromAlbum: async (albumId: string, photoId: string): Promise<void> => {
    await apiClient.delete(`/api/albums/${albumId}/photos/${photoId}`);
  },
};

// Face Recognition API
export const facesApi = {
  // GDPR Consent
  getConsent: async (): Promise<ConsentResponse> => {
    const response = await apiClient.get<ConsentResponse>('/api/faces/consent');
    return response.data;
  },

  giveConsent: async (): Promise<ConsentResponse> => {
    const response = await apiClient.post<ConsentResponse>('/api/faces/consent/give');
    return response.data;
  },

  revokeConsent: async (deleteData: boolean = false, reason: string = 'User request'): Promise<ConsentResponse> => {
    const response = await apiClient.post<ConsentResponse>('/api/faces/consent/revoke', {
      delete_data: deleteData,
      reason,
    });
    return response.data;
  },

  // Face Detection
  detectFaces: async (photoId: string, model: string = 'hog'): Promise<FaceDetectionResponse> => {
    const response = await apiClient.post<FaceDetectionResponse>(`/api/faces/detect/${photoId}`, null, {
      params: { model },
    });
    return response.data;
  },

  getPhotoFaces: async (photoId: string): Promise<Face[]> => {
    const response = await apiClient.get<Face[]>(`/api/faces/photo/${photoId}`);
    return response.data;
  },

  // Person Management
  listPersons: async (): Promise<Person[]> => {
    const response = await apiClient.get<Person[]>('/api/faces/persons');
    return response.data;
  },

  getPerson: async (personId: string): Promise<Person> => {
    const response = await apiClient.get<Person>(`/api/faces/persons/${personId}`);
    return response.data;
  },

  updatePerson: async (personId: string, data: PersonUpdateRequest): Promise<Person> => {
    const response = await apiClient.patch<Person>(`/api/faces/persons/${personId}`, data);
    return response.data;
  },

  deletePerson: async (personId: string): Promise<void> => {
    await apiClient.delete(`/api/faces/persons/${personId}`);
  },

  // Face Labeling
  labelFace: async (faceId: string, data: FaceLabelRequest): Promise<Face> => {
    const response = await apiClient.post<Face>(`/api/faces/label/${faceId}`, data);
    return response.data;
  },

  getSimilarFaces: async (faceId: string, threshold: number = 0.6, limit: number = 10): Promise<SimilarFace[]> => {
    const response = await apiClient.get<SimilarFace[]>(`/api/faces/similar/${faceId}`, {
      params: { threshold, limit },
    });
    return response.data;
  },

  // Clustering
  getClusters: async (): Promise<Cluster[]> => {
    const response = await apiClient.get<Cluster[]>('/api/faces/clusters');
    return response.data;
  },

  labelCluster: async (clusterId: number, personName: string): Promise<{ message: string; person_id: string }> => {
    const response = await apiClient.post(`/api/faces/clusters/${clusterId}/label`, null, {
      params: { person_name: personName },
    });
    return response.data;
  },
};

export default apiClient;
