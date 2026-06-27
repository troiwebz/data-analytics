import { useState, useRef } from 'react'
import toast from 'react-hot-toast'

const LIME = '#adff2f'
const BG = '#0d1117'
const CARD = '#161b22'
const CARD2 = '#1c2128'
const BORDER = '#21262d'

const mockSubmissions = [
  { id: 'sub1', drill: 'Cover Drive — 20 Balls', coach: 'Rahul Sharma', submittedDate: '2026-05-25', status: 'reviewed', uploadMethod: 'file', score: 82, starRating: 4, feedback: 'Excellent effort! Your elbow position is much improved. Work on keeping your head still at contact. Commit to foot movement — forward or back, not in between. Great progress from last week.', thumbnailColor: 'linear-gradient(135deg, #16a34a, #166534)' },
  { id: 'sub2', drill: 'Yorker Delivery — 15 Balls', coach: 'Vikram Singh', submittedDate: '2026-05-26', status: 'pending', uploadMethod: 'link', score: null, starRating: null, feedback: null, estimatedReview: '~12 hours', thumbnailColor: 'linear-gradient(135deg, #1d4ed8, #1e40af)' },
  { id: 'sub3', drill: 'Batting Stance Self-Assessment', coach: 'Rahul Sharma', submittedDate: '2026-05-18', status: 'reviewed', uploadMethod: 'file', score: 68, starRating: 3, feedback: 'Good start! Your stance fundamentals are solid. Focus on widening your base — feet should be slightly wider than shoulder-width. Your grip needs work: bottom hand is too dominant.', thumbnailColor: 'linear-gradient(135deg, #7c3aed, #6d28d9)' },
  { id: 'sub4', drill: 'Pull Shot Practice — 10 Balls', coach: 'Rahul Sharma', submittedDate: '2026-05-24', status: 'pending', uploadMethod: 'file', score: null, starRating: null, feedback: null, estimatedReview: '~24 hours', thumbnailColor: 'linear-gradient(135deg, #ea580c, #c2410c)' },
  { id: 'sub5', drill: 'Fielding — 30 Catches', coach: 'Priya Nair', submittedDate: '2026-05-15', status: 'reviewed', uploadMethod: 'link', score: 91, starRating: 5, feedback: 'Outstanding! Technique is excellent. Clean hands, good positioning. Continue this form.', thumbnailColor: 'linear-gradient(135deg, #0891b2, #0e7490)' },
]

const COACHES = ['Rahul Sharma', 'Vikram Singh', 'Priya Nair']
const TABS = ['All', 'Pending Review', 'Reviewed']

function StarRating({ count }) {
  return (
    <span>
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} style={{ color: i <= count ? '#eab308' : BORDER, fontSize: 16 }}>★</span>
      ))}
    </span>
  )
}

export default function StudentSubmissions() {
  const [activeTab, setActiveTab] = useState('All')
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadTab, setUploadTab] = useState('file')
  const [expandedFeedback, setExpandedFeedback] = useState(new Set())
  const [uploadForm, setUploadForm] = useState({ drill: '', coach: '', videoFile: null, videoLink: '', notes: '', priority: 'normal' })
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  const filtered = mockSubmissions.filter(s => {
    if (activeTab === 'Pending Review') return s.status === 'pending'
    if (activeTab === 'Reviewed') return s.status === 'reviewed'
    return true
  })

  const toggleFeedback = (id) => {
    setExpandedFeedback(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleFileSelect = (file) => {
    if (!file) return
    if (!file.type.startsWith('video/')) { toast.error('Please select a video file'); return }
    if (file.size > 500 * 1024 * 1024) { toast.error('File exceeds 500MB limit'); return }
    setUploadForm(p => ({ ...p, videoFile: file }))
    setIsUploading(true)
    setUploadProgress(0)
    let progress = 0
    const interval = setInterval(() => {
      progress += Math.random() * 15
      if (progress >= 100) { progress = 100; clearInterval(interval); setIsUploading(false) }
      setUploadProgress(Math.min(Math.round(progress), 100))
    }, 200)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    handleFileSelect(e.dataTransfer.files[0])
  }

  const handleSubmitVideo = () => {
    if (!uploadForm.drill.trim()) { toast.error('Please enter the drill/topic'); return }
    if (!uploadForm.coach) { toast.error('Please select a coach'); return }
    if (uploadTab === 'file' && !uploadForm.videoFile) { toast.error('Please select a video file'); return }
    if (uploadTab === 'link' && !uploadForm.videoLink.trim()) { toast.error('Please paste a video link'); return }
    toast.success('Video submitted for review! Your coach will respond within 24 hours.')
    setShowUploadModal(false)
    setUploadForm({ drill: '', coach: '', videoFile: null, videoLink: '', notes: '', priority: 'normal' })
    setUploadProgress(0)
    setIsUploading(false)
  }

  const inputStyle = { width: '100%', background: BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box', color: '#fff', fontFamily: 'inherit' }
  const formatBytes = (bytes) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

  return (
    <div style={{ padding: '28px 32px', fontFamily: 'system-ui,-apple-system,sans-serif', color: '#fff' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '1px' }}>MY SUBMISSIONS</h1>
          <p style={{ color: 'rgba(255,255,255,0.45)', marginTop: 4, marginBottom: 0, fontSize: 14 }}>Submit videos for coach review and track feedback</p>
        </div>
        <button onClick={() => setShowUploadModal(true)} style={{ padding: '10px 22px', background: LIME, color: '#000', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>↑</span> Upload Video
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Total Submissions', value: mockSubmissions.length, icon: '📹', color: '#fff' },
          { label: 'Pending Review', value: mockSubmissions.filter(s => s.status === 'pending').length, icon: '⏳', color: '#eab308' },
          { label: 'Reviewed', value: mockSubmissions.filter(s => s.status === 'reviewed').length, icon: '✅', color: LIME },
        ].map(stat => (
          <div key={stat.label} style={{ background: CARD, borderRadius: 12, padding: '16px 20px', border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>{stat.icon}</span>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: stat.color }}>{stat.value}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '6px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: activeTab === tab ? LIME : 'transparent', color: activeTab === tab ? '#000' : 'rgba(255,255,255,0.5)' }}>
            {tab}
          </button>
        ))}
      </div>

      {/* Submissions List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {filtered.map(sub => (
          <div key={sub.id} style={{ background: CARD, borderRadius: 16, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
            <div style={{ padding: '18px 24px' }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ width: 80, height: 60, borderRadius: 10, flexShrink: 0, background: sub.thumbnailColor, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  onClick={() => toast('Video preview coming soon!', { icon: '▶️' })}>
                  <span style={{ fontSize: 28, opacity: 0.9 }}>▶</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: 0 }}>{sub.drill}</h3>
                    <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: sub.status === 'reviewed' ? LIME + '20' : '#eab30820', color: sub.status === 'reviewed' ? LIME : '#eab308' }}>
                      {sub.status === 'reviewed' ? 'Reviewed' : 'Pending Review'}
                    </span>
                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: BORDER, color: 'rgba(255,255,255,0.5)' }}>
                      {sub.uploadMethod === 'file' ? '📁 File Upload' : '🔗 Link'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>👤 {sub.coach}</span>
                    {sub.submittedDate && <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>📅 {sub.submittedDate}</span>}
                  </div>

                  {sub.status === 'reviewed' && sub.starRating !== null && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        {[1,2,3,4,5].map(s => (
                          <span key={s} style={{ fontSize: 20, filter: sub.starRating >= s ? 'none' : 'grayscale(1) opacity(0.25)' }}>⭐</span>
                        ))}
                        <span style={{ fontSize: 13, fontWeight: 700, color: sub.starRating >= 5 ? LIME : sub.starRating >= 4 ? '#adff2f' : sub.starRating >= 3 ? '#eab308' : '#ef4444', marginLeft: 4 }}>
                          {sub.starRating >= 5 ? '🔥 Excellent' : sub.starRating >= 4 ? '👍 Good' : sub.starRating >= 3 ? '📈 Average' : '💪 Needs Work'}
                        </span>
                      </div>
                      {sub.feedback && (
                        <button onClick={() => toggleFeedback(sub.id)} style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', color: LIME, fontSize: 13, fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {expandedFeedback.has(sub.id) ? '▼' : '▶'} Coach Feedback
                        </button>
                      )}
                      {expandedFeedback.has(sub.id) && sub.feedback && (
                        <div style={{ marginTop: 8, background: CARD2, borderRadius: 10, padding: '12px 16px', borderLeft: `4px solid ${LIME}` }}>
                          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.7 }}>{sub.feedback}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {sub.status === 'pending' && (
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#eab308', boxShadow: '0 0 0 3px rgba(234,179,8,0.2)' }} />
                      <span style={{ fontSize: 13, color: '#eab308' }}>Awaiting review · Est. {sub.estimatedReview}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'rgba(255,255,255,0.35)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📹</div>
          <p style={{ fontSize: 16 }}>No submissions in this category.</p>
        </div>
      )}

      {/* UPLOAD VIDEO MODAL */}
      {showUploadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 20, padding: 28, width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>Submit Video for Coach Review</h2>
              <button onClick={() => { setShowUploadModal(false); setUploadProgress(0); setIsUploading(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'rgba(255,255,255,0.5)' }}>×</button>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, marginTop: 4, marginBottom: 24 }}>Upload your practice video and get detailed feedback from your coach</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6, letterSpacing: '1px', textTransform: 'uppercase' }}>What are you working on? *</label>
                <input type="text" placeholder="e.g. Cover Drive technique, Yorker delivery..." value={uploadForm.drill} onChange={e => setUploadForm(p => ({ ...p, drill: e.target.value }))} style={inputStyle} />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6, letterSpacing: '1px', textTransform: 'uppercase' }}>Select Coach *</label>
                <select value={uploadForm.coach} onChange={e => setUploadForm(p => ({ ...p, coach: e.target.value }))} style={inputStyle}>
                  <option value="">Choose your coach...</option>
                  {COACHES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 10, letterSpacing: '1px', textTransform: 'uppercase' }}>Video *</label>
                <div style={{ display: 'flex', gap: 0, marginBottom: 14, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', width: 'fit-content' }}>
                  {['file', 'link'].map(t => (
                    <button key={t} onClick={() => setUploadTab(t)} style={{ padding: '7px 18px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: uploadTab === t ? LIME : 'transparent', color: uploadTab === t ? '#000' : 'rgba(255,255,255,0.5)' }}>
                      {t === 'file' ? '📁 Upload File' : '🔗 YouTube / Link'}
                    </button>
                  ))}
                </div>

                {uploadTab === 'file' && (
                  <div>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      style={{ border: `2px dashed ${isDragging ? LIME : BORDER}`, borderRadius: 12, padding: '32px 20px', textAlign: 'center', cursor: 'pointer', background: isDragging ? LIME + '08' : CARD2, transition: 'all 0.15s ease' }}
                    >
                      <div style={{ fontSize: 36, marginBottom: 8 }}>↑</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>Drag & drop your video here</div>
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>or click to browse</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>MP4, MOV, AVI — max 500MB</div>
                    </div>
                    <input ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={e => handleFileSelect(e.target.files[0])} />

                    {uploadForm.videoFile && (
                      <div style={{ marginTop: 12, background: LIME + '10', borderRadius: 10, padding: '12px 16px', border: `1px solid ${LIME}40` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{uploadForm.videoFile.name}</div>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{formatBytes(uploadForm.videoFile.size)}</div>
                          </div>
                          <button onClick={e => { e.stopPropagation(); setUploadForm(p => ({ ...p, videoFile: null })); setUploadProgress(0); setIsUploading(false) }} style={{ background: '#ef444420', border: 'none', cursor: 'pointer', borderRadius: '50%', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', fontWeight: 700, fontSize: 14 }}>×</button>
                        </div>
                        <div style={{ background: BORDER, borderRadius: 4, height: 6 }}>
                          <div style={{ height: '100%', borderRadius: 4, background: LIME, width: `${uploadProgress}%`, transition: 'width 0.2s ease' }} />
                        </div>
                        <div style={{ fontSize: 11, color: LIME, marginTop: 4, textAlign: 'right' }}>
                          {isUploading ? `Uploading... ${uploadProgress}%` : 'Upload complete ✓'}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {uploadTab === 'link' && (
                  <div>
                    <input type="url" placeholder="Paste YouTube, Google Drive or any video link..." value={uploadForm.videoLink} onChange={e => setUploadForm(p => ({ ...p, videoLink: e.target.value }))} style={inputStyle} />
                    <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: '6px 0 0' }}>Supports YouTube, Google Drive, Dropbox, Vimeo links</p>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6, letterSpacing: '1px', textTransform: 'uppercase' }}>Notes to Coach</label>
                <textarea placeholder="Describe what you want feedback on..." rows={3} value={uploadForm.notes} onChange={e => setUploadForm(p => ({ ...p, notes: e.target.value }))} style={{ ...inputStyle, resize: 'vertical' }} />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 10, letterSpacing: '1px', textTransform: 'uppercase' }}>Priority</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  {['normal', 'urgent'].map(p => (
                    <button key={p} onClick={() => setUploadForm(f => ({ ...f, priority: p }))} style={{ padding: '8px 20px', borderRadius: 8, cursor: 'pointer', border: uploadForm.priority === p ? `2px solid ${p === 'urgent' ? '#ef4444' : LIME}` : `2px solid ${BORDER}`, background: uploadForm.priority === p ? (p === 'urgent' ? '#ef444415' : LIME + '15') : 'transparent', fontWeight: 600, fontSize: 13, color: uploadForm.priority === p ? (p === 'urgent' ? '#ef4444' : LIME) : 'rgba(255,255,255,0.5)' }}>
                      {p === 'normal' ? 'Normal' : '🚨 Urgent'}
                    </button>
                  ))}
                </div>
                {uploadForm.priority === 'urgent' && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: '#ef444415', borderRadius: 8, fontSize: 12, color: '#ef4444', fontWeight: 500 }}>Urgent submissions are reviewed within 6 hours</div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button onClick={() => { setShowUploadModal(false); setUploadProgress(0); setIsUploading(false) }} style={{ flex: 1, padding: '11px', borderRadius: 10, border: `1px solid ${BORDER}`, background: 'transparent', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontWeight: 500, fontSize: 14 }}>Cancel</button>
              <button onClick={handleSubmitVideo} style={{ flex: 2, padding: '11px', borderRadius: 10, background: LIME, color: '#000', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>Submit for Review</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
