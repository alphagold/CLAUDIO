import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Face } from '../types';
import { facesApi } from '../api/client';

interface FaceOverlayProps {
  photoId: string;
  imageUrl: string;
  onFaceClick?: (face: Face) => void;
  showLabels?: boolean;
  className?: string;
  refreshTrigger?: string | number | null;
  drawMode?: boolean;
  onManualFaceDrawn?: (bbox: { x: number; y: number; width: number; height: number }) => void;
}

/**
 * FaceOverlay Component
 *
 * Mostra bounding boxes sui volti rilevati in una foto.
 * Gestisce scaling automatico da coordinate naturali a dimensioni display.
 * Supporta drawMode per disegnare bbox manualmente.
 */
export const FaceOverlay: React.FC<FaceOverlayProps> = ({
  photoId,
  imageUrl,
  onFaceClick,
  showLabels = true,
  className = '',
  refreshTrigger,
  drawMode = false,
  onManualFaceDrawn,
}) => {
  const [faces, setFaces] = useState<Face[]>([]);
  const [loading, setLoading] = useState(true);
  const [featureAvailable, setFeatureAvailable] = useState(true);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Draw mode state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  // Fetch faces for this photo
  useEffect(() => {
    const fetchFaces = async () => {
      try {
        setLoading(true);
        const fetchedFaces = await facesApi.getPhotoFaces(photoId);
        setFaces(fetchedFaces);
        setFeatureAvailable(true);
      } catch (error: any) {
        console.error('Failed to fetch faces:', error);
        if (error?.response?.status === 404) {
          setFeatureAvailable(false);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchFaces();
  }, [photoId, refreshTrigger]);

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

  // Update display size on resize (debounced)
  const updateDisplaySize = useCallback(() => {
    if (imgRef.current) {
      setDisplaySize({
        width: imgRef.current.clientWidth,
        height: imgRef.current.clientHeight,
      });
    }
  }, []);

  // Listen for window resize with debounce
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const debouncedResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(updateDisplaySize, 150);
    };
    window.addEventListener('resize', debouncedResize);
    return () => {
      window.removeEventListener('resize', debouncedResize);
      clearTimeout(timeoutId);
    };
  }, [updateDisplaySize]);

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

  // Draw mode: get mouse position relative to image
  const getMousePos = (e: React.MouseEvent): { x: number; y: number } | null => {
    if (!imgRef.current) return null;
    const rect = imgRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!drawMode) return;
    const pos = getMousePos(e);
    if (!pos) return;
    e.preventDefault();
    setIsDrawing(true);
    setDrawStart(pos);
    setDrawCurrent(pos);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawMode || !isDrawing) return;
    const pos = getMousePos(e);
    if (!pos) return;
    e.preventDefault();
    setDrawCurrent(pos);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!drawMode || !isDrawing || !drawStart || !drawCurrent) {
      setIsDrawing(false);
      return;
    }
    e.preventDefault();
    setIsDrawing(false);

    if (!naturalSize || !displaySize) return;

    // Calculate display rect
    const left = Math.min(drawStart.x, drawCurrent.x);
    const top = Math.min(drawStart.y, drawCurrent.y);
    const width = Math.abs(drawCurrent.x - drawStart.x);
    const height = Math.abs(drawCurrent.y - drawStart.y);

    // Minimum size check (at least 10px display)
    if (width < 10 || height < 10) {
      setDrawStart(null);
      setDrawCurrent(null);
      return;
    }

    // Convert display → natural coordinates
    const scaleX = naturalSize.width / displaySize.width;
    const scaleY = naturalSize.height / displaySize.height;

    const naturalBbox = {
      x: Math.round(left * scaleX),
      y: Math.round(top * scaleY),
      width: Math.round(width * scaleX),
      height: Math.round(height * scaleY),
    };

    setDrawStart(null);
    setDrawCurrent(null);

    onManualFaceDrawn?.(naturalBbox);
  };

  // Draw preview rect
  const getDrawRect = () => {
    if (!drawStart || !drawCurrent) return null;
    return {
      left: Math.min(drawStart.x, drawCurrent.x),
      top: Math.min(drawStart.y, drawCurrent.y),
      width: Math.abs(drawCurrent.x - drawStart.x),
      height: Math.abs(drawCurrent.y - drawStart.y),
    };
  };

  const drawRect = getDrawRect();

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Image */}
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Photo with faces"
        className="w-full h-auto"
        onLoad={handleImageLoad}
        draggable={false}
      />

      {/* Draw mode overlay (cattura mouse events) */}
      {drawMode && displaySize && (
        <div
          className="absolute inset-0 cursor-crosshair"
          style={{ zIndex: 20 }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            if (isDrawing) {
              setIsDrawing(false);
              setDrawStart(null);
              setDrawCurrent(null);
            }
          }}
        >
          {/* Draw preview rectangle */}
          {isDrawing && drawRect && (
            <div
              className="absolute border-2 border-dashed border-green-400 bg-green-400/10"
              style={{
                left: `${drawRect.left}px`,
                top: `${drawRect.top}px`,
                width: `${drawRect.width}px`,
                height: `${drawRect.height}px`,
              }}
            />
          )}
        </div>
      )}

      {/* Face bounding boxes */}
      {!loading && faces.length > 0 && naturalSize && displaySize && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: drawMode ? 10 : 'auto' }}>
          {faces.map((face) => {
            const scaledBbox = getScaledBbox(face);
            if (!scaledBbox) return null;

            return (
              <div
                key={face.id}
                className={`absolute border-2 ${face.person_name ? 'border-green-500' : 'border-blue-500'} ${!drawMode ? 'pointer-events-auto cursor-pointer hover:border-blue-600 hover:bg-blue-500/10' : ''} transition-all`}
                style={{
                  left: `${scaledBbox.left}px`,
                  top: `${scaledBbox.top}px`,
                  width: `${scaledBbox.width}px`,
                  height: `${scaledBbox.height}px`,
                }}
                onClick={() => !drawMode && onFaceClick?.(face)}
                title={face.person_name || 'Persona sconosciuta'}
              >
                {/* Label */}
                {showLabels && (
                  <div className={`absolute -top-6 left-0 ${face.person_name ? 'bg-green-500' : 'bg-blue-500'} text-white text-xs px-2 py-1 rounded whitespace-nowrap`}>
                    {face.person_name || '?'}
                  </div>
                )}

                {/* Quality indicator */}
                {face.quality_score && face.quality_score < 0.5 && (
                  <div className="absolute bottom-0 right-0 bg-yellow-500 text-white text-xs px-1 rounded-tl">
                    Bassa qualità
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
            Caricamento volti...
          </div>
        </div>
      )}

      {/* Draw mode hint */}
      {drawMode && !isDrawing && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-green-600/90 text-white text-sm px-4 py-2 rounded-lg shadow-lg" style={{ zIndex: 30 }}>
          Disegna un rettangolo sul volto da aggiungere
        </div>
      )}

      {/* Feature not available */}
      {!loading && !featureAvailable && (
        <div className="absolute top-4 right-4 bg-gray-800/80 text-white text-xs px-3 py-1 rounded max-w-48 text-center leading-snug">
          Riconoscimento facciale non disponibile su questo server
        </div>
      )}
    </div>
  );
};

export default FaceOverlay;
