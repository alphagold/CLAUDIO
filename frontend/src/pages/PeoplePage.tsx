import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Trash2, Edit2, Check, X } from 'lucide-react';
import { facesApi } from '../api/client';
import type { Person } from '../types';
import toast from 'react-hot-toast';

/**
 * PeoplePage
 *
 * Lista tutte le persone identificate dal sistema face recognition.
 * Permette di modificare nomi, note, ed eliminare persone (GDPR).
 */
export const PeoplePage: React.FC = () => {
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchPersons();
  }, []);

  const fetchPersons = async () => {
    try {
      setLoading(true);
      const data = await facesApi.listPersons();
      setPersons(data);
    } catch (error) {
      console.error('Failed to fetch persons:', error);
      toast.error('Failed to load people');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (person: Person) => {
    setEditingId(person.id);
    setEditName(person.name || '');
    setEditNotes(person.notes || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditNotes('');
  };

  const saveEdit = async (personId: string) => {
    try {
      await facesApi.updatePerson(personId, {
        name: editName || undefined,
        notes: editNotes || undefined,
      });
      toast.success('Person updated');
      setEditingId(null);
      fetchPersons();
    } catch (error) {
      console.error('Failed to update person:', error);
      toast.error('Failed to update person');
    }
  };

  const deletePerson = async (personId: string, personName: string | null) => {
    const confirmed = window.confirm(
      `Delete ${personName || 'this person'}? All face labels will be removed (photos won't be deleted).`
    );

    if (!confirmed) return;

    try {
      await facesApi.deletePerson(personId);
      toast.success('Person deleted');
      fetchPersons();
    } catch (error) {
      console.error('Failed to delete person:', error);
      toast.error('Failed to delete person');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading people...</div>
      </div>
    );
  }

  if (persons.length === 0) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-bold mb-6">People</h1>
        <div className="bg-gray-50 rounded-lg p-8 text-center">
          <User className="w-16 h-16 mx-auto mb-4 text-gray-400" />
          <h2 className="text-xl font-semibold mb-2">No people identified yet</h2>
          <p className="text-gray-600 mb-4">
            Upload photos and enable face recognition to start identifying people.
          </p>
          <button
            onClick={() => navigate('/settings')}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">People ({persons.length})</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {persons.map((person) => (
          <div
            key={person.id}
            className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow overflow-hidden"
          >
            {/* Representative face photo */}
            {person.representative_face_id && (
              <div className="h-48 bg-gray-200 relative">
                {/* TODO: Fetch and display representative face thumbnail */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <User className="w-16 h-16 text-gray-400" />
                </div>
              </div>
            )}

            {/* Person info */}
            <div className="p-4">
              {editingId === person.id ? (
                // Edit mode
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Name"
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Notes"
                    rows={2}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(person.id)}
                      className="flex-1 bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700 flex items-center justify-center gap-1"
                    >
                      <Check className="w-4 h-4" /> Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="flex-1 bg-gray-600 text-white px-3 py-2 rounded hover:bg-gray-700 flex items-center justify-center gap-1"
                    >
                      <X className="w-4 h-4" /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                // View mode
                <>
                  <h3 className="text-xl font-semibold mb-1">
                    {person.name || (
                      <span className="text-gray-400">Unknown Person</span>
                    )}
                  </h3>

                  {person.notes && (
                    <p className="text-sm text-gray-600 mb-2">{person.notes}</p>
                  )}

                  <div className="flex items-center gap-4 text-sm text-gray-500 mb-3">
                    <span>{person.photo_count} photos</span>
                    {person.is_verified && (
                      <span className="text-green-600 font-medium">✓ Verified</span>
                    )}
                  </div>

                  {person.first_seen_at && (
                    <p className="text-xs text-gray-400 mb-3">
                      First seen: {new Date(person.first_seen_at).toLocaleDateString()}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => startEdit(person)}
                      className="flex-1 bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700 flex items-center justify-center gap-1"
                    >
                      <Edit2 className="w-4 h-4" /> Edit
                    </button>
                    <button
                      onClick={() => deletePerson(person.id, person.name)}
                      className="bg-red-600 text-white px-3 py-2 rounded hover:bg-red-700"
                      title="Delete person"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PeoplePage;
