// User types
export interface User {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

// Photo types
export interface Photo {
  id: string;
  user_id: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  uploaded_at: string;
  description_full: string | null;
  description_short: string | null;
  extracted_text: string | null;
  detected_objects: string[];
  detected_faces: number;
  scene_category: string | null;
  scene_subcategory: string | null;
  tags: string[];
  confidence_score: number;
  analyzed_at: string | null;
  processing_time_ms: number | null;
  model_version: string | null;
}

export interface PhotoUploadResponse {
  photo: Photo;
  message: string;
}

export interface PhotosResponse {
  photos: Photo[];
  total: number;
  skip: number;
  limit: number;
}

// Album types
export interface Album {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  cover_photo_id: string | null;
  created_at: string;
  updated_at: string;
  photo_count?: number;
}

export interface CreateAlbumRequest {
  name: string;
  description?: string;
}

// Search types
export interface SearchQuery {
  query?: string;
  scene_category?: string;
  tags?: string[];
  date_from?: string;
  date_to?: string;
  limit?: number;
  skip?: number;
}
