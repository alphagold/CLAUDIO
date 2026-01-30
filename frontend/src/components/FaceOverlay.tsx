import React, { useState, useEffect, useRef } from 'react';
import type { Face } from '../types';
import { facesApi } from '../api/client';

interface FaceOverlayProps {
  photoId: string;
  imageUrl: string;
  onFaceClick?: (face: Face) => void;
  showLabels?: boolean;
  className?: string;
}

/**
 * FaceOverlay Component
 *
 * Mostra bounding boxes sui volti rilevati in una foto.
 * Gestisce scaling automatico da coordinate naturali a dimensioni display.
 */
export const FaceOverlay: React.FC<FaceOverlayProps> = ({
  photoId,
  imageUrl,
  onFaceClick,
  showLabels = true,
  className = '',
}) => {
  const [faces, setFaces] = useState<Face[]>([]);
  const [loading, setLoading] = useState(true);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch faces for this photo
  useEffect(() => {
    const fetchFaces = async () => {
      try {
        setLoading(true);
        const fetchedFaces = await facesApi.getPhotoFaces(photoId);
        setFaces(fetchedFaces);
      } catch (error) {
        console.error('Failed to fetch faces:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFaces();
  }, [photoId]);

  // Get natural image size when image loads
  const handleImageLoad = () => {
    if (imgRef.current) {
      setNaturalSize({
        width: imgRef.current.naturalWidth,
        height: imgRef.current.naturalHeight,
      });
      updateDisplaySize();
    }
  };

  // Update display size on resize
  const updateDisplaySize = () => {
    if (imgRef.current) {
      setDisplaySize({
        width: imgRef.current.clientWidth,
        height: imgRef.current.clientHeight,
      });
    }
  };

  // Listen for window resize
  useEffect(() => {
    window.addEventListener('resize', updateDisplaySize);
    return () => window.removeEventListener('resize', updateDisplaySize);
  }, []);

  // Re-calculate display size when image loads
  useEffect(() => {
    if (imgRef.current && imgRef.current.complete) {
      handleImageLoad();
    }
  }, [imageUrl]);

  // Calculate scaled bbox coordinates
  const getScaledBbox = (face: Face) => {
    if (!naturalSize || !displaySize) return null;

    const scaleX = displaySize.width / naturalSize.width;
    const scaleY = displaySize.height / naturalSize.height;

    return {
      left: face.bbox.x * scaleX,
      top: face.bbox.y * scaleY,
      width: face.bbox.width * scaleX,
      height: face.bbox.height * scaleY,
    };
  };

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Image */}
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Photo with faces"
        className="w-full h-auto"
        onLoad={handleImageLoad}
      />

      {/* Face bounding boxes */}
      {!loading && faces.length > 0 && naturalSize && displaySize && (
        <div className="absolute inset-0 pointer-events-none">
          {faces.map((face) => {
            const scaledBbox = getScaledBbox(face);
            if (!scaledBbox) return null;

            return (
              <div
                key={face.id}
                className="absolute border-2 border-blue-500 pointer-events-auto cursor-pointer hover:border-blue-600 hover:bg-blue-500/10 transition-all"
                style={{
                  left: `${scaledBbox.left}px`,
                  top: `${scaledBbox.top}px`,
                  width: `${scaledBbox.width}px`,
                  height: `${scaledBbox.height}px`,
                }}
                onClick={() => onFaceClick?.(face)}
                title={face.person_name || 'Unknown person'}
              >
                {/* Label */}
                {showLabels && (
                  <div className="absolute -top-6 left-0 bg-blue-500 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                    {face.person_name || '?'}
                  </div>
                )}

                {/* Quality indicator */}
                {face.quality_score && face.quality_score < 0.5 && (
                  <div className="absolute bottom-0 right-0 bg-yellow-500 text-white text-xs px-1 rounded-tl">
                    Low quality
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="bg-white px-4 py-2 rounded shadow">
            Loading faces...
          </div>
        </div>
      )}

      {/* No faces message */}
      {!loading && faces.length === 0 && (
        <div className="absolute top-4 right-4 bg-gray-800/80 text-white text-sm px-3 py-1 rounded">
          No faces detected
        </div>
      )}
    </div>
  );
};

export default FaceOverlay;
