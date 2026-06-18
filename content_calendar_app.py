#!/usr/bin/env python3
"""
ContentFlow — AI-Powered Content Calendar & Project Management
Professional SaaS platform. Run: python3 content_calendar_app.py
Visit: http://localhost:8080
"""

from flask import Flask, render_template, request, jsonify, session, redirect, send_file
from flask_cors import CORS
import sqlite3, json, os, uuid, threading, time as time_module
from datetime import datetime, timedelta
import anthropic, smtplib, ssl, urllib.request, urllib.parse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import secrets as _secrets
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
CORS(app)
DB_PATH = "/tmp/content_calendar.db"
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'contentflow-dev-2025-changeMe!')
SCREENSHOTS_DIR = os.path.expanduser('~/Desktop/ContentFlow_Screenshots')

# ── Google OAuth constants ────────────────────────────────────────────────────
GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth'
GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
GOOGLE_USERINFO  = 'https://www.googleapis.com/oauth2/v3/userinfo'

# ── Claude lazy init ──────────────────────────────────────────────────────────
_claude_client = None
_gen_progress = {}   # {calendar_id: {'done': int, 'total': int, 'status': str}}

def get_claude_client():
    global _claude_client
    api_key = os.environ.get("ANTHROPIC_API_KEY") or get_setting("anthropic_api_key")
    if not api_key:
        raise ValueError("API key not set. Go to Settings and enter your Anthropic API key.")
    _claude_client = anthropic.Anthropic(api_key=api_key)
    return _claude_client

def get_setting(key):
    try:
        row = query_db('SELECT value FROM settings WHERE key=?', (key,), one=True)
        return row['value'] if row else None
    except Exception:
        return None

def set_setting(key, value):
    execute_db('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (key, str(value) if value is not None else ''))

# ── DB helpers ────────────────────────────────────────────────────────────────
def query_db(query, args=(), one=False):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute(query, args)
    rv = c.fetchall()
    conn.close()
    return (rv[0] if rv else None) if one else rv

def execute_db(query, args=()):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(query, args)
    conn.commit()
    conn.close()

def add_column_if_missing(conn, table, column, definition):
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    except Exception:
        pass

# ── DB init ───────────────────────────────────────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute('PRAGMA journal_mode=WAL')   # allow concurrent reads during background writes
    conn.execute('PRAGMA synchronous=NORMAL') # safe + faster than FULL with WAL
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    # Projects (extended client table)
    c.execute('''CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        niche TEXT NOT NULL,
        business_type TEXT,
        goal TEXT,
        -- target audience
        target_age TEXT,
        target_gender TEXT,
        target_location TEXT,
        target_interests TEXT,
        target_pain_points TEXT,
        -- strategy
        tone_of_voice TEXT DEFAULT 'Fun & Relatable',
        campaign_days INTEGER DEFAULT 30,
        goal_type TEXT DEFAULT 'followers',
        posting_frequency TEXT DEFAULT 'Daily',
        value_bomb_types TEXT DEFAULT '["Value Bomb","Carousel Tutorial","Free PDF Bomb"]',
        -- brand
        unique_selling_point TEXT,
        brand_colors TEXT,
        competitor_handles TEXT,
        -- meta
        status TEXT DEFAULT 'active',
        color TEXT DEFAULT '#667eea',
        emoji TEXT DEFAULT '🚀',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    # Migrate existing clients table
    migrations = [
        ('target_age','TEXT'), ('target_gender','TEXT'), ('target_location','TEXT'),
        ('target_interests','TEXT'), ('target_pain_points','TEXT'),
        ('tone_of_voice','TEXT DEFAULT "Fun & Relatable"'), ('campaign_days','INTEGER DEFAULT 30'),
        ('goal_type','TEXT DEFAULT "followers"'), ('posting_frequency','TEXT DEFAULT "Daily"'),
        ('value_bomb_types','TEXT DEFAULT "[]"'), ('unique_selling_point','TEXT'),
        ('brand_colors','TEXT'), ('competitor_handles','TEXT'),
        ('status','TEXT DEFAULT "active"'), ('color','TEXT DEFAULT "#667eea"'),
        ('emoji','TEXT DEFAULT "🚀"'),
    ]
    for col, defn in migrations:
        add_column_if_missing(conn, 'clients', col, defn)

    c.execute('''CREATE TABLE IF NOT EXISTS calendars (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        month TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        total_budget REAL DEFAULT 0,
        goal_type TEXT DEFAULT 'followers',
        campaign_days INTEGER DEFAULT 30,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id)
    )''')
    add_column_if_missing(conn, 'calendars', 'goal_type', 'TEXT DEFAULT "followers"')
    add_column_if_missing(conn, 'calendars', 'campaign_days', 'INTEGER DEFAULT 30')

    c.execute('''CREATE TABLE IF NOT EXISTS concepts (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        date TEXT NOT NULL,
        content_type TEXT NOT NULL,
        format TEXT DEFAULT 'Reel',
        hook TEXT NOT NULL,
        problem TEXT,
        solution TEXT,
        cta TEXT,
        platform TEXT DEFAULT 'Instagram',
        status TEXT DEFAULT 'idea',
        assigned_to TEXT,
        assignee_id TEXT,
        priority TEXT DEFAULT 'medium',
        daily_budget REAL DEFAULT 5,
        predicted_engagement REAL DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (calendar_id) REFERENCES calendars(id)
    )''')
    for col, defn in [('format','TEXT DEFAULT "Reel"'),('priority','TEXT DEFAULT "medium"'),
                      ('notes','TEXT'),('assignee_id','TEXT'),('platform','TEXT DEFAULT "Instagram"'),
                      ('idea_brief','TEXT'),('image_prompt','TEXT'),('video_prompt','TEXT'),
                      ('finished_at','TEXT'),('is_overdue','INTEGER DEFAULT 0'),
                      ('boost_status','TEXT DEFAULT "none"'),('boost_notes','TEXT'),
                      ('verification_status','TEXT'),('grid_slot_type','TEXT')]:
        add_column_if_missing(conn, 'concepts', col, defn)

    c.execute('''CREATE TABLE IF NOT EXISTS captions (
        id TEXT PRIMARY KEY,
        concept_id TEXT NOT NULL,
        variation_number INTEGER,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS hashtags (
        id TEXT PRIMARY KEY,
        concept_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        volume_level TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        concept_id TEXT NOT NULL,
        assigned_to TEXT,
        employee_id TEXT,
        status TEXT DEFAULT 'todo',
        priority TEXT DEFAULT 'medium',
        due_date TEXT,
        submitted_at TIMESTAMP,
        approved_at TIMESTAMP,
        published_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    add_column_if_missing(conn, 'tasks', 'priority', 'TEXT DEFAULT "medium"')

    c.execute('''CREATE TABLE IF NOT EXISTS metrics (
        id TEXT PRIMARY KEY,
        concept_id TEXT NOT NULL,
        date TEXT,
        views INTEGER DEFAULT 0,
        engagement_rate REAL DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        saves INTEGER DEFAULT 0,
        sales INTEGER DEFAULT 0,
        follower_gain INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT,
        client_id TEXT,
        email TEXT,
        avatar_color TEXT DEFAULT '#667eea',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    add_column_if_missing(conn, 'team_members', 'avatar_color', 'TEXT DEFAULT "#667eea"')
    add_column_if_missing(conn, 'team_members', 'phone', 'TEXT DEFAULT ""')

    # ── Pending invites ───────────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        email TEXT,
        phone TEXT,
        name TEXT,
        app_role TEXT DEFAULT 'worker',
        invited_by TEXT,
        client_id TEXT,
        used INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    # New: comments on concepts
    c.execute('''CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        concept_id TEXT NOT NULL,
        author TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    # New: project activity feed
    c.execute('''CREATE TABLE IF NOT EXISTS activity_feed (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    # New: milestones
    c.execute('''CREATE TABLE IF NOT EXISTS milestones (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        due_date TEXT,
        completed INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    # ── Users (Google OAuth) ─────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        picture TEXT,
        google_id TEXT,
        role TEXT DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
    )''')
    for col, defn in [('role','TEXT DEFAULT "user"'),('google_id','TEXT'),
                       ('last_login','TIMESTAMP'),('password_hash','TEXT'),
                       ('last_seen','TIMESTAMP')]:
        add_column_if_missing(conn, 'users', col, defn)

    # ── Seed demo accounts (idempotent) ─────────────────────────────────────
    _demo_accounts = [
        ('admin@contentflow.app',  'Admin',     'admin',     'admin123'),
        ('manager@contentflow.app','Manager',   'manager',   'manager123'),
        ('exec@contentflow.app',   'Executive', 'executive', 'exec123'),
        ('worker@contentflow.app', 'Worker',    'worker',    'worker123'),
    ]
    for email, name, role, pw in _demo_accounts:
        existing = c.execute('SELECT id FROM users WHERE email=?', (email,)).fetchone()
        if not existing:
            uid = str(uuid.uuid4())
            ph  = generate_password_hash(pw)
            c.execute('INSERT INTO users (id,email,name,role,password_hash) VALUES (?,?,?,?,?)',
                      (uid, email, name, role, ph))
        else:
            # ensure password_hash is set on existing demo accounts
            row = c.execute('SELECT password_hash FROM users WHERE email=?', (email,)).fetchone()
            if not row or not row[0]:
                c.execute('UPDATE users SET password_hash=?, role=? WHERE email=?',
                          (generate_password_hash(pw), role, email))
    conn.commit()

    # ── Task timers ───────────────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS task_timers (
        id TEXT PRIMARY KEY,
        user_email TEXT,
        concept_id TEXT,
        client_id TEXT,
        task_name TEXT,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        stopped_at TIMESTAMP,
        duration_seconds INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running',
        notes TEXT
    )''')

    # ── Timer screenshots ─────────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS timer_screenshots (
        id TEXT PRIMARY KEY,
        timer_id TEXT NOT NULL,
        captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        filepath TEXT,
        filename TEXT
    )''')

    # ── Calendar grids ────────────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS calendar_grids (
        id TEXT PRIMARY KEY,
        client_id TEXT,
        name TEXT,
        grid_type TEXT,
        grid_config TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS campaign_grid_configs (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL,
        grid_index INTEGER NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        color TEXT DEFAULT '#6366f1',
        content_types TEXT DEFAULT '[]',
        icon TEXT DEFAULT '📝',
        UNIQUE(calendar_id, grid_index)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS offer_history (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL,
        day INTEGER,
        grid_index INTEGER,
        offer_text TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS campaign_offer_pool (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL,
        grid_index INTEGER NOT NULL DEFAULT 0,
        grid_name TEXT DEFAULT '',
        offer_text TEXT NOT NULL,
        hook_line TEXT DEFAULT '',
        urgency TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')
    # Migration: add grid_index / grid_name columns to existing tables if absent
    try:
        c.execute('ALTER TABLE campaign_offer_pool ADD COLUMN grid_index INTEGER NOT NULL DEFAULT 0')
    except Exception:
        pass
    try:
        c.execute('ALTER TABLE campaign_offer_pool ADD COLUMN grid_name TEXT DEFAULT ""')
    except Exception:
        pass

    # ── Team Chat ────────────────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS team_chat (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        user_role TEXT DEFAULT 'worker',
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    # ── Seed Venus Venture demo project (idempotent) ─────────────────────────
    import datetime as _dt
    _vv_exists = c.execute("SELECT id FROM clients WHERE name='Venus Venture'").fetchone()
    if not _vv_exists:
        _vv_id  = 'demo-venus-venture-001'
        _cal_id = 'demo-venus-cal-june-2026'
        c.execute('''INSERT INTO clients
            (id,name,niche,business_type,goal,tone_of_voice,campaign_days,goal_type,
             posting_frequency,unique_selling_point,target_age,target_gender,
             target_location,target_interests,target_pain_points,
             brand_colors,competitor_handles,status,color,emoji)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', (
            _vv_id,
            'Venus Venture',
            'Lifestyle & Wellness',
            'Boutique Wellness Studio',
            'Build brand awareness and grow online community to 10k followers',
            'Warm & Inspiring',
            30, 'followers', 'Daily',
            'Holistic wellness experiences combining fitness, nutrition and mindfulness in Bangkok',
            '25–45', 'Primarily Female', 'Bangkok, Thailand',
            'Yoga, Health Food, Self-Care, Mindfulness, Meditation',
            'Stress, work-life balance, finding quality wellness services',
            '#FF6B9D,#C44FFF,#FFD93D',
            '@wellnessbkk,@yogabangkok',
            'active', '#FF6B9D', '🌸'
        ))

        c.execute('''INSERT INTO calendars
            (id,client_id,month,status,total_budget,goal_type,campaign_days)
            VALUES (?,?,?,?,?,?,?)''',
            (_cal_id, _vv_id, 'June 2026', 'active', 150.0, 'followers', 30))

        _today = _dt.date(2026, 6, 1)
        _concepts = [
            # (day, content_type, format, hook, problem, solution, cta, platform, status, priority, budget, eng, assigned_to)
            (1,  'Value Bomb',       'Reel',     '5 morning habits that changed my life 🌅',
             'You wake up exhausted every day',
             'A 20-min morning ritual proven to boost energy by 60%',
             'Save this for tomorrow morning ✨', 'Instagram', 'published', 'high',   5.0, 8.4, 'worker@contentflow.app'),
            (2,  'Behind the Scenes','Story',    'What a day at Venus Venture really looks like 🌸',
             'Wellness feels inaccessible and intimidating',
             'See how welcoming and real our studio is',
             'Book a free trial class today 👇', 'Instagram', 'published', 'medium', 0.0, 5.1, 'exec@contentflow.app'),
            (3,  'Testimonial',      'Carousel', '"I lost 5kg and finally sleep well" — Sarah\'s story',
             'Feeling like nothing works for weight loss',
             'Consistent yoga + nutrition coaching over 8 weeks',
             'Read her full story → link in bio', 'Instagram', 'published', 'high',   8.0, 9.2, 'worker@contentflow.app'),
            (4,  'Educational',      'Reel',     'Why you\'re always hungry at 3pm (and how to fix it)',
             'Energy crashes and sugar cravings every afternoon',
             'The right macronutrient balance for sustained energy',
             'Comment "GUIDE" for our free nutrition PDF 📄', 'Instagram', 'published', 'medium', 5.0, 7.8, 'exec@contentflow.app'),
            (5,  'Product Promo',    'Reel',     'Introducing our NEW 30-day Glow Up challenge 🔥',
             'Starting a wellness journey alone is overwhelming',
             'A structured, community-backed 30-day program',
             'Join before spots fill — link in bio!', 'Instagram', 'approved', 'high',   10.0, 0.0, 'manager@contentflow.app'),
            (6,  'Value Bomb',       'Carousel', '7 yoga poses for office workers with back pain',
             'Sitting at a desk all day destroys your posture',
             'These 7 gentle stretches take only 10 minutes',
             'Share with a colleague who needs this 💛', 'Instagram', 'approved', 'medium', 5.0, 0.0, 'worker@contentflow.app'),
            (7,  'Community Post',   'Story',    'Which class would YOU want us to add? 🙋‍♀️',
             'Members want more variety in class schedule',
             'Let the community vote and shape our timetable',
             'Vote in the poll above ☝️', 'Instagram', 'in_review', 'low',    0.0, 0.0, 'exec@contentflow.app'),
            (8,  'Educational',      'Reel',     'The truth about detox teas nobody tells you ☕',
             'Misleading wellness marketing wastes your money',
             'Science-backed nutrition habits that actually work',
             'Follow for more evidence-based wellness tips', 'Instagram', 'in_review', 'high',   5.0, 0.0, 'worker@contentflow.app'),
            (9,  'Collaboration',    'Reel',     'We tried Bangkok\'s top 5 healthy cafes ☕🥗',
             'Eating healthy in the city is expensive and boring',
             'Our curated guide to affordable clean-eating spots',
             'Save this for your next lunch break 📍', 'Instagram', 'idea', 'medium', 0.0, 0.0, 'exec@contentflow.app'),
            (10, 'Value Bomb',       'Carousel', '10 signs your cortisol is too high (and what to do)',
             'Chronic stress silently damages your health',
             'Practical daily habits to lower cortisol naturally',
             'Tag a friend who needs to see this 🫶', 'Instagram', 'idea', 'high',   5.0, 0.0, ''),
            (11, 'Testimonial',      'Reel',     '"I went from 0 to running 5km in 6 weeks" — Tom\'s story',
             'Beginners feel embarrassed joining fitness classes',
             'Our beginner-friendly programs welcome all levels',
             'DM us "START" to begin your journey', 'Instagram', 'idea', 'medium', 8.0, 0.0, ''),
            (12, 'Product Promo',    'Carousel', 'Our June membership deal — 30% off all plans 🎉',
             'Premium wellness is out of budget for many people',
             'Limited-time offer makes quality wellness accessible',
             'Tap the link in bio before June 15 ⏰', 'Instagram', 'idea', 'high',   15.0, 0.0, ''),
            (13, 'Educational',      'Reel',     'How to meditate when your mind won\'t stop racing 🧠',
             'People give up meditation because it feels impossible',
             'The 4-7-8 breathing technique for instant calm',
             'Try this tonight and tell us how it goes 💬', 'Instagram', 'idea', 'medium', 5.0, 0.0, ''),
            (14, 'Behind the Scenes','Reel',     'Prepping 200 acai bowls for our studio opening 🍓',
             'People don\'t know the hard work behind the brand',
             'An authentic look at our team and passion',
             'Follow our journey 🌸', 'Instagram', 'idea', 'low',    0.0, 0.0, ''),
            (15, 'Value Bomb',       'Carousel', 'The 5-minute bedtime routine for deeper sleep 😴',
             'Poor sleep ruins workout recovery and mood',
             'Science-backed pre-sleep habits for quality rest',
             'Save + share with someone who can\'t sleep 💤', 'Instagram', 'idea', 'high',   5.0, 0.0, ''),
        ]

        _status_map = {
            'published': ('published', '2026-05-{:02d}'),
            'approved':  ('approved',  None),
            'in_review': ('in_review', None),
            'idea':      ('idea',      None),
        }

        for i, (day, ctype, fmt, hook, prob, sol, cta, plat, status, prio, budget, eng, assignee) in enumerate(_concepts):
            cid = f'demo-vv-concept-{i+1:03d}'
            date_str = (_today + _dt.timedelta(days=day-1)).isoformat()
            c.execute('''INSERT INTO concepts
                (id,calendar_id,day,date,content_type,format,hook,problem,solution,
                 cta,platform,status,assigned_to,priority,daily_budget,predicted_engagement)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', (
                cid, _cal_id, day, date_str, ctype, fmt, hook, prob, sol,
                cta, plat, status, assignee, prio, budget, eng
            ))

            # Add captions for published concepts
            if status == 'published':
                cap_id = f'demo-vv-cap-{i+1:03d}'
                caption_text = f"{hook}\n\n{sol}\n\n{cta}\n\n#VenusVenture #WellnessBangkok #HealthyLiving"
                c.execute('INSERT INTO captions (id,concept_id,variation_number,text) VALUES (?,?,?,?)',
                          (cap_id, cid, 1, caption_text))
                for j, tag in enumerate(['VenusVenture','WellnessBangkok','HealthyLiving','SelfCare','YogaBKK']):
                    c.execute('INSERT INTO hashtags (id,concept_id,tag,volume_level) VALUES (?,?,?,?)',
                              (f'demo-vv-tag-{i+1:03d}-{j}', cid, f'#{tag}', ['high','high','medium','medium','low'][j]))

            # Add task records
            task_status = 'published' if status == 'published' else ('approved' if status == 'approved' else 'todo')
            c.execute('''INSERT INTO tasks (id,concept_id,assigned_to,status,priority,due_date)
                VALUES (?,?,?,?,?,?)''',
                (f'demo-vv-task-{i+1:03d}', cid, assignee, task_status, prio,
                 (_today + _dt.timedelta(days=day-1)).isoformat()))

            # Add metrics for published concepts
            if status == 'published':
                views   = [3400, 1200, 5800, 2900][i % 4]
                clicks  = int(views * 0.08)
                saves   = int(views * 0.05)
                sales   = [2, 0, 3, 1][i % 4]
                fgain   = [12, 5, 22, 9][i % 4]
                c.execute('''INSERT INTO metrics
                    (id,concept_id,date,views,engagement_rate,clicks,saves,sales,follower_gain)
                    VALUES (?,?,?,?,?,?,?,?,?)''',
                    (f'demo-vv-metric-{i+1:03d}', cid, date_str, views, eng, clicks, saves, sales, fgain))

        # Add demo team members
        for tid, tname, trole, tcolor in [
            ('demo-vv-tm-1','Sofia Kaewmanee','Yoga Instructor','#FF6B9D'),
            ('demo-vv-tm-2','Arisa Thongdee','Nutritionist','#C44FFF'),
            ('demo-vv-tm-3','Mika Suzuki','Content Creator','#FFD93D'),
        ]:
            c.execute('''INSERT OR IGNORE INTO team_members (id,name,role,client_id,avatar_color)
                VALUES (?,?,?,?,?)''', (tid, tname, trole, _vv_id, tcolor))

    conn.commit()
    conn.close()

# ── AI functions ──────────────────────────────────────────────────────────────
VALUE_BOMB_FORMATS = {
    "Value Bomb":        ("Reel",     "💡"),
    "Free PDF Bomb":     ("Reel",     "📄"),
    "Template Drop":     ("Carousel", "📋"),
    "Secret Video":      ("Reel",     "🎬"),
    "Carousel Tutorial": ("Carousel", "🎠"),
    "Tutorial Reel":     ("Reel",     "🎓"),
    "Q&A Bomb":          ("Reel",     "❓"),
    "Behind the Scenes": ("Reel",     "🎥"),
    "Godfather Offer":   ("Reel",     "🤝"),
    "Flash Sale":        ("Story",    "⚡"),
    "Bundle Deal":       ("Reel",     "📦"),
}

GRID_TYPE_CONTENT_MAP = {
    'Follower Push':      ['Value Bomb', 'Carousel Tutorial', 'Free PDF Bomb', 'Secret Video', 'Template Drop'],
    'Value Info Push':    ['Value Bomb', 'Carousel Tutorial', 'Tutorial Reel', 'Q&A Bomb'],
    'Sales Push':         ['Godfather Offer', 'Flash Sale', 'Bundle Deal'],
    'Awareness Post':     ['Value Bomb', 'Behind the Scenes', 'Tutorial Reel'],
    'Consideration Post': ['Carousel Tutorial', 'Q&A Bomb', 'Secret Video', 'Tutorial Reel'],
    'Conversion Post':    ['Godfather Offer', 'Flash Sale', 'Bundle Deal'],
    'Educational Post':   ['Carousel Tutorial', 'Tutorial Reel', 'Q&A Bomb'],
    'Entertainment Post': ['Value Bomb', 'Behind the Scenes'],
    'Inspirational Post': ['Value Bomb', 'Behind the Scenes', 'Secret Video'],
    'Sales Post':         ['Godfather Offer', 'Flash Sale', 'Bundle Deal'],
    'Engagement Post':    ['Q&A Bomb', 'Template Drop', 'Value Bomb'],
}

def generate_concepts_with_claude(project, calendar_data, grid_schedule=None):
    client_name    = project['name']
    niche          = project['niche']
    business_type  = project.get('business_type','')
    goal           = project.get('goal','')
    tone           = project.get('tone_of_voice','Fun & Relatable')
    target_age     = project.get('target_age','25-35')
    target_interests = project.get('target_interests','')
    pain_points    = project.get('target_pain_points','')
    usp            = project.get('unique_selling_point','')
    campaign_days  = calendar_data.get('campaign_days', 30)
    goal_type      = calendar_data.get('goal_type','followers')
    start_date     = calendar_data.get('start_date', datetime.now().strftime("%Y-%m-%d"))

    try:
        vb_types = json.loads(project.get('value_bomb_types') or '[]')
    except Exception:
        vb_types = []
    if not vb_types:
        vb_types = ["Value Bomb", "Carousel Tutorial", "Free PDF Bomb"]

    if goal_type == "sales":
        offer_count   = max(1, round(campaign_days * 0.40))
        vb_count      = campaign_days - offer_count
        mix_note      = f"{offer_count} Godfather Offers, {vb_count} Value Bombs. Offers are urgent, limited-time, irresistible."
    else:
        offer_count   = max(1, round(campaign_days * 0.20))
        vb_count      = campaign_days - offer_count
        mix_note      = f"{vb_count} Value Bombs (variety: {', '.join(vb_types[:4])}), {offer_count} Godfather Offers."

    allowed_types = vb_types + ["Godfather Offer", "Flash Sale", "Bundle Deal"]
    solutions_text = ', '.join(project.get('solutions') if isinstance(project.get('solutions'), list) else [usp])

    # ── Build content plan section (grid-locked or free-mix) ─────────────────
    if grid_schedule:
        grid_plan_lines = []
        for s in grid_schedule:
            opts = GRID_TYPE_CONTENT_MAP.get(s['type'], ['Value Bomb'])
            opts_str = ' / '.join(opts[:3])
            grid_plan_lines.append(f"  Day {s['day']:02d}: [{s['type']}] → choose content_type from: {opts_str}")
        grid_plan_str = '\n'.join(grid_plan_lines)
        plan_section = f"""GRID ROTATION — MANDATORY (do NOT deviate):
Each day's content_type must come from the allowed list for that rotation slot.

{grid_plan_str}

Content-type category guide:
- Follower Push   → Value Bomb, Carousel Tutorial, Free PDF Bomb, Secret Video, Template Drop
- Value Info Push → Value Bomb, Carousel Tutorial, Tutorial Reel, Q&A Bomb
- Sales Push      → Godfather Offer, Flash Sale, Bundle Deal
- Awareness Post  → Value Bomb, Behind the Scenes, Tutorial Reel
- Consideration   → Carousel Tutorial, Q&A Bomb, Secret Video, Tutorial Reel
- Conversion Post → Godfather Offer, Flash Sale, Bundle Deal
- Educational     → Carousel Tutorial, Tutorial Reel, Q&A Bomb
- Entertainment   → Value Bomb, Behind the Scenes
- Inspirational   → Value Bomb, Behind the Scenes, Secret Video
- Sales Post      → Godfather Offer, Flash Sale, Bundle Deal
- Engagement Post → Q&A Bomb, Template Drop, Value Bomb"""
    else:
        plan_section = f"""{mix_note}
Available types: {', '.join(allowed_types)}"""

    prompt = f"""You are an elite social media content strategist who builds real audiences for real businesses.

Create {campaign_days} SPECIFIC, ACTIONABLE content concepts for {client_name} — a {business_type} in the {niche} space.

BRAND PROFILE:
- USP: {usp}
- Tone: {tone}
- Solutions they provide: {solutions_text}

TARGET AUDIENCE (age {target_age}):
- Interests: {target_interests}
- Pain points: {pain_points}

STRICT QUALITY RULES:
1. Hooks must name a SPECIFIC result or number: "We posted 1 photo/day for 30 days — here's what changed" NOT "Tips for better posts"
2. Solutions must give EXACT steps with real tactics: "Post food photos at 6-8PM Mon-Thu + tag your city name" NOT "Post consistently"
3. Value Bombs = things they can implement TODAY with clear before/after or measurable outcome
4. Include niche-specific authority content: Google Maps tricks for restaurants, conversion copy for e-commerce, client case studies for services
5. idea_brief: 2-3 sentences describing EXACTLY what content to create — what specific data/story/steps are shown, what real tip is taught, and what makes it worth sharing

FORMAT GUIDE:
- "Carousel Tutorial" → 7-slide step-by-step (specific steps with real examples), format: Carousel
- "Value Bomb" → 30-60 sec reel: one game-changing tactic with proof, format: Reel
- "Free PDF Bomb" → tease a real checklist/guide viewers can download, format: Reel
- "Template Drop" → swipeable template they can screenshot and use today, format: Carousel
- "Secret Video" → reveal ONE insider tactic competitors don't share, format: Reel
- "Tutorial Reel" → 60s how-to with clear result shown, format: Reel
- "Q&A Bomb" → answer THE most-asked question in the niche with specifics, format: Reel
- "Behind the Scenes" → day-in-the-life or process reveal with real numbers, format: Reel
- "Godfather Offer" → irresistible offer with specific value + scarcity, format: Reel

CONTENT PLAN ({campaign_days} days):
{plan_section}

Output EXACTLY {campaign_days} JSON objects, one per line, NO markdown, NO extra text:
{{"day":1,"content_type":"Carousel Tutorial","format":"Carousel","hook":"We tracked our Google Maps views for 30 days — the #1 ranking trick nobody talks about","problem":"Most {niche} businesses are invisible on Google Maps despite great reviews","solution":"Add 1 new photo every 3 days at 6PM with your city + neighbourhood in the filename — we went from page 3 to top 3 in 28 days","cta":"Save this carousel and update your first photo tonight","platform":"Instagram","predicted_engagement_percent":4.8,"idea_brief":"A 7-slide carousel with actual Google Maps screenshots showing the before/after ranking. Slide 1: Shocking stat (73% of local searches go to the top 3). Slides 2-5: The exact 4-step Google Business Profile optimisation checklist (categories, photos, description keywords, Q&A). Slide 6: Our 30-day timeline with real numbers. Slide 7: Free checklist CTA."}}

Make every hook, problem, and solution 100% specific to {niche}. No generic advice. Real value every day."""

    message = get_claude_client().messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}]
    )

    concepts = []
    start_dt = datetime.strptime(start_date, "%Y-%m-%d")
    for line in message.content[0].text.strip().split('\n'):
        line = line.strip()
        if line.startswith('{') and line.endswith('}'):
            try:
                c = json.loads(line)
                c['date'] = (start_dt + timedelta(days=c['day']-1)).strftime("%Y-%m-%d")
                fmt = VALUE_BOMB_FORMATS.get(c.get('content_type','Value Bomb'), ('Reel','💡'))
                if not c.get('format'):
                    c['format'] = fmt[0]
                concepts.append(c)
            except Exception:
                continue
    return concepts

def generate_captions_with_claude(hook, problem, solution, cta, niche, tone="Fun & Relatable", content_type="Value Bomb"):
    prompt = f"""Write 5 {tone} Instagram/TikTok captions for:
Content type: {content_type}
Hook: {hook}
Problem: {problem}
Solution: {solution}
CTA: {cta}
Niche: {niche}

Each caption: hook line, 3-4 body lines, CTA, line break, hashtags inline.
Output ONLY JSON (no markdown):
{{"captions":[{{"number":1,"text":"..."}},...,{{"number":5,"text":"..."}}],"hashtags":["#tag1",...,"#tag15"]}}"""

    message = get_claude_client().messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=900,
        messages=[{"role": "user", "content": prompt}]
    )
    try:
        txt = message.content[0].text
        s, e = txt.find('{'), txt.rfind('}')+1
        return json.loads(txt[s:e])
    except Exception:
        return {"captions":[], "hashtags":[]}

# ── Routes ────────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    user = session.get('user') or {'id':'guest','email':'guest@local','name':'Guest','picture':'','role':'worker'}
    return render_template('dashboard.html', current_user=user)

# Stats
@app.route('/api/stats')
def get_stats():
    clients   = query_db('SELECT COUNT(*) as n FROM clients')[0]['n']
    calendars = query_db('SELECT COUNT(*) as n FROM calendars')[0]['n']
    published = query_db("SELECT COUNT(*) as n FROM concepts WHERE status='published'")[0]['n']
    metrics   = query_db('SELECT SUM(views) v, AVG(engagement_rate) e, SUM(sales) s, SUM(follower_gain) f FROM metrics')[0]
    tasks_done= query_db("SELECT COUNT(*) as n FROM tasks WHERE status='published'")[0]['n']
    return jsonify({
        'total_clients': clients, 'total_calendars': calendars,
        'published_posts': published, 'tasks_completed': tasks_done,
        'total_views': metrics['v'] or 0,
        'avg_engagement': f"{metrics['e'] or 0:.2f}%",
        'total_sales': f"${metrics['s'] or 0:,.0f}",
        'follower_growth': metrics['f'] or 0,
    })

# Projects (clients)
@app.route('/api/clients', methods=['GET','POST'])
def manage_clients():
    if request.method == 'GET':
        rows = query_db('SELECT * FROM clients ORDER BY created_at DESC')
        result = []
        for r in rows:
            p = dict(r)
            # attach member count and calendar count
            p['member_count']   = query_db('SELECT COUNT(*) as n FROM team_members WHERE client_id=?',(p['id'],))[0]['n']
            p['calendar_count'] = query_db('SELECT COUNT(*) as n FROM calendars WHERE client_id=?',(p['id'],))[0]['n']
            result.append(p)
        return jsonify(result)

    data = request.json
    pid  = str(uuid.uuid4())
    execute_db('''INSERT INTO clients
        (id,name,niche,business_type,goal,target_age,target_gender,target_location,
         target_interests,target_pain_points,tone_of_voice,campaign_days,goal_type,
         posting_frequency,value_bomb_types,unique_selling_point,brand_colors,
         competitor_handles,color,emoji)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', (
        pid,
        data.get('name',''), data.get('niche',''), data.get('business_type',''),
        data.get('goal',''), data.get('target_age',''), data.get('target_gender',''),
        data.get('target_location',''), data.get('target_interests',''),
        data.get('target_pain_points',''), data.get('tone_of_voice','Fun & Relatable'),
        int(data.get('campaign_days',30)), data.get('goal_type','followers'),
        data.get('posting_frequency','Daily'),
        json.dumps(data.get('value_bomb_types',['Value Bomb','Carousel Tutorial','Free PDF Bomb'])),
        data.get('unique_selling_point',''), data.get('brand_colors',''),
        data.get('competitor_handles',''),
        data.get('color','#667eea'), data.get('emoji','🚀'),
    ))
    # log activity
    execute_db('INSERT INTO activity_feed (id,project_id,actor,action,target) VALUES (?,?,?,?,?)',
               (str(uuid.uuid4()), pid, data.get('created_by','You'), 'created project', data.get('name','')))
    return jsonify({'id': pid, 'status': 'created'})

@app.route('/api/clients/<client_id>', methods=['GET','PUT','DELETE'])
def get_client(client_id):
    if request.method == 'DELETE':
        # Cascade delete
        cals = query_db('SELECT id FROM calendars WHERE client_id=?', (client_id,))
        for cal in cals:
            cids = [dict(r)['id'] for r in query_db('SELECT id FROM concepts WHERE calendar_id=?', (cal['id'],))]
            for cid in cids:
                execute_db('DELETE FROM captions WHERE concept_id=?', (cid,))
                execute_db('DELETE FROM hashtags WHERE concept_id=?', (cid,))
                execute_db('DELETE FROM comments WHERE concept_id=?', (cid,))
                execute_db('DELETE FROM metrics WHERE concept_id=?', (cid,))
            execute_db('DELETE FROM concepts WHERE calendar_id=?', (cal['id'],))
            execute_db('DELETE FROM milestones WHERE project_id=?', (client_id,))
            execute_db('DELETE FROM team_members WHERE client_id=?', (client_id,))
            execute_db('DELETE FROM activity_feed WHERE project_id=?', (client_id,))
        execute_db('DELETE FROM calendars WHERE client_id=?', (client_id,))
        execute_db('DELETE FROM clients WHERE id=?', (client_id,))
        return jsonify({'status': 'deleted'})
    if request.method == 'PUT':
        data = request.json
        fields = []
        values = []
        allowed = ['name','niche','business_type','goal','target_age','target_gender',
                   'target_location','target_interests','target_pain_points','tone_of_voice',
                   'campaign_days','goal_type','posting_frequency','value_bomb_types',
                   'unique_selling_point','brand_colors','competitor_handles','color','emoji','status']
        for k in allowed:
            if k in data:
                fields.append(f'{k}=?')
                values.append(data[k])
        if fields:
            values.append(client_id)
            execute_db(f"UPDATE clients SET {','.join(fields)} WHERE id=?", values)
        return jsonify({'status':'updated'})
    row = query_db('SELECT * FROM clients WHERE id=?',(client_id,),one=True)
    if not row:
        return jsonify({'error':'Not found'}),404
    p = dict(row)
    p['members']   = [dict(m) for m in query_db('SELECT * FROM team_members WHERE client_id=?',(client_id,))]
    p['calendars'] = [dict(c) for c in query_db('SELECT * FROM calendars WHERE client_id=? ORDER BY created_at DESC',(client_id,))]
    p['milestones']= [dict(m) for m in query_db('SELECT * FROM milestones WHERE project_id=? ORDER BY due_date',(client_id,))]
    p['activity']  = [dict(a) for a in query_db('SELECT * FROM activity_feed WHERE project_id=? ORDER BY created_at DESC LIMIT 20',(client_id,))]
    # Total concepts across all calendars for this project
    tc = query_db('SELECT COUNT(*) as n FROM concepts WHERE calendar_id IN (SELECT id FROM calendars WHERE client_id=?)', (client_id,), one=True)
    p['total_concepts'] = tc['n'] if tc else 0
    # Published / approved count
    pub = query_db("SELECT COUNT(*) as n FROM concepts WHERE status IN ('published','approved') AND calendar_id IN (SELECT id FROM calendars WHERE client_id=?)", (client_id,), one=True)
    p['published_concepts'] = pub['n'] if pub else 0
    return jsonify(p)

@app.route('/api/clients/<client_id>/content-strategy', methods=['POST'])
def generate_content_strategy(client_id):
    row = query_db('SELECT * FROM clients WHERE id=?', (client_id,), one=True)
    if not row:
        return jsonify({'error': 'Not found'}), 404
    c = dict(row)
    niche = c.get('niche') or ''
    btype = c.get('business_type') or ''
    pain  = c.get('target_pain_points') or ''
    usp   = c.get('unique_selling_point') or ''
    try:
        client_obj = get_claude_client()
        prompt = f"""You are a content strategist expert in social media marketing for {btype} businesses in {niche}.

Generate 10 VALUE BOMBS and 10 GODFATHER OFFERS for this business.

Business context:
- Niche: {niche}
- Type: {btype}
- Audience pain: {pain}
- USP: {usp}

DEFINITIONS:
- VALUE BOMB: Free educational content so good people feel they should pay for it (PDF checklists, templates, swipe files, video tutorials, mini-guides)
- GODFATHER OFFER: An offer so irresistible the audience feels stupid to say no (bundle, guarantee, bonus stack, limited access)

Return ONLY this JSON (no markdown, no extra text):
{{
  "value_bombs": [
    {{"id": 1, "title": "Specific title max 8 words", "description": "Exactly what's inside — 1-2 sentences", "format": "Free PDF|Checklist|Template|Video Tutorial|Swipe File|Mini-Guide|Toolkit", "why_they_need_it": "One compelling reason — creates urgency"}},
    ...10 items...
  ],
  "godfather_offers": [
    {{"id": 1, "title": "Offer name max 8 words", "what_you_get": "Specific deliverables — 1-2 sentences", "value_stack": "e.g. Worth $500+ normally", "irresistible_hook": "Why they can't say no in 1 sentence"}},
    ...10 items...
  ]
}}"""
        msg = client_obj.messages.create(
            model='claude-haiku-4-5-20251001', max_tokens=3500,
            messages=[{'role': 'user', 'content': prompt}]
        )
        txt = msg.content[0].text.strip()
        # Strip markdown code fences if present
        if txt.startswith('```'):
            txt = txt.split('```', 2)[1]
            if txt.startswith('json'):
                txt = txt[4:]
            txt = txt.rsplit('```', 1)[0]
        s, e = txt.find('{'), txt.rfind('}')+1
        raw_json = txt[s:e] if s >= 0 else ''
        try:
            data = json.loads(raw_json)
        except json.JSONDecodeError:
            # Lenient repair: remove trailing commas before ] or }
            import re
            fixed = re.sub(r',\s*([\}\]])', r'\1', raw_json)
            try:
                data = json.loads(fixed)
            except Exception:
                data = {'error': 'parse_failed', 'raw': raw_json[:300]}
        return jsonify(data)
    except Exception as ex:
        return jsonify({'error': str(ex)}), 500

# Team members
@app.route('/api/clients/<client_id>/members', methods=['GET','POST'])
def manage_members(client_id):
    if request.method == 'GET':
        rows = query_db('SELECT * FROM team_members WHERE client_id=?',(client_id,))
        return jsonify([dict(r) for r in rows])
    data = request.json
    mid  = str(uuid.uuid4())
    colors = ['#667eea','#f59e0b','#10b981','#ef4444','#3b82f6','#8b5cf6','#ec4899']
    color  = colors[len(query_db('SELECT id FROM team_members WHERE client_id=?',(client_id,))) % len(colors)]
    execute_db('INSERT INTO team_members (id,name,role,client_id,email,avatar_color) VALUES (?,?,?,?,?,?)',
               (mid, data.get('name',''), data.get('role',''), client_id, data.get('email',''), color))
    execute_db('INSERT INTO activity_feed (id,project_id,actor,action,target) VALUES (?,?,?,?,?)',
               (str(uuid.uuid4()), client_id, 'You', 'added team member', data.get('name','')))
    return jsonify({'id':mid,'status':'added'})

@app.route('/api/team/members/<mid>', methods=['DELETE'])
def remove_member(mid):
    execute_db('DELETE FROM team_members WHERE id=?',(mid,))
    return jsonify({'status':'removed'})

# Calendars
@app.route('/api/calendars', methods=['GET','POST'])
def manage_calendars():
    if request.method == 'GET':
        cid = request.args.get('client_id')
        if cid:
            rows = query_db('SELECT * FROM calendars WHERE client_id=? ORDER BY created_at DESC',(cid,))
        else:
            rows = query_db('SELECT * FROM calendars ORDER BY created_at DESC')
        return jsonify([dict(r) for r in rows])

    data      = request.json
    client_id = data['client_id']
    goal_type = data.get('goal_type','followers')
    days      = int(data.get('campaign_days', 30))
    grid_id   = data.get('grid_id')

    project = query_db('SELECT * FROM clients WHERE id=?',(client_id,),one=True)
    if not project:
        return jsonify({'error':'Project not found'}),404

    # ── create_only: just insert an empty calendar record (no AI generation) ─
    if data.get('create_only'):
        cal_id = str(uuid.uuid4())
        # Always store month as YYYY-MM (ISO). Prefer start_date[:7], fallback to month field.
        raw_month = data.get('start_date') or data.get('month') or datetime.now().strftime('%Y-%m')
        month_label = raw_month[:7]  # guarantees "2026-06" even if passed "June 2026"
        execute_db('INSERT INTO calendars (id,client_id,month,status,goal_type,campaign_days) VALUES (?,?,?,?,?,?)',
                   (cal_id, client_id, month_label, 'draft', goal_type, days))
        execute_db('INSERT INTO activity_feed (id,project_id,actor,action,target) VALUES (?,?,?,?,?)',
                   (str(uuid.uuid4()), client_id, 'System', 'created campaign', month_label))
        return jsonify({'id': cal_id, 'calendar_id': cal_id, 'status': 'created'})

    api_key = os.environ.get("ANTHROPIC_API_KEY") or get_setting("anthropic_api_key")
    if not api_key:
        return jsonify({'error':'API key not set. Go to Settings.'}),400

    # ── Compute grid rotation schedule ────────────────────────────────────────
    grid_schedule = None
    if grid_id:
        g_tmpl = next((g for g in GRID_TEMPLATES if g['id'] == grid_id), None)
        if g_tmpl:
            s_dt  = datetime.strptime(data.get('start_date', datetime.now().strftime('%Y-%m-%d')), '%Y-%m-%d')
            pat   = g_tmpl['pattern']
            grid_schedule = []
            for d in range(days):
                dt      = s_dt + timedelta(days=d)
                weekday = dt.weekday()
                week_i  = d // 7
                if pat == 'am_pm':
                    t = g_tmpl['slots'][d % 2]          # alternate AM/PM daily
                elif pat == 'weekday_map':
                    t = g_tmpl['weekday_map'].get(weekday, g_tmpl['slots'][0])
                elif pat == 'funnel_weeks':
                    if week_i <= 1:  t = g_tmpl['slots'][0]
                    elif week_i == 2: t = g_tmpl['slots'][1]
                    else:             t = g_tmpl['slots'][2]
                elif pat == 'five_cycle':
                    t = g_tmpl['slots'][d % 5]
                elif pat == 'ratio':
                    ratio = g_tmpl['ratio']
                    total = sum(ratio)
                    pos   = d % total
                    cum   = 0; t = g_tmpl['slots'][0]
                    for i, r in enumerate(ratio):
                        cum += r
                        if pos < cum:
                            t = g_tmpl['slots'][i] if i < len(g_tmpl['slots']) else g_tmpl['slots'][0]
                            break
                else:
                    t = g_tmpl['slots'][0]
                grid_schedule.append({'day': d + 1, 'type': t})

    try:
        calendar_data = {
            'start_date':    data.get('start_date', datetime.now().strftime("%Y-%m-%d")),
            'campaign_days': days,
            'goal_type':     goal_type,
        }
        concepts = generate_concepts_with_claude(dict(project), calendar_data, grid_schedule=grid_schedule)
        if not concepts:
            return jsonify({'error':'AI returned no concepts. Try again.'}),500

        cal_id = str(uuid.uuid4())
        execute_db('INSERT INTO calendars (id,client_id,month,status,goal_type,campaign_days) VALUES (?,?,?,?,?,?)',
                   (cal_id, client_id, calendar_data['start_date'][:7], 'draft', goal_type, days))

        # Build a day→grid_slot_type lookup from the grid_schedule (if a grid was used)
        grid_slot_lookup = {}
        if grid_schedule:
            for s in grid_schedule:
                grid_slot_lookup[s['day']] = s['type']

        concept_ids = []
        for con in concepts:
            cid = str(uuid.uuid4())
            slot_type = grid_slot_lookup.get(con['day'])  # None if no grid used
            execute_db('''INSERT INTO concepts
                (id,calendar_id,day,date,content_type,format,hook,problem,solution,cta,platform,predicted_engagement,idea_brief,grid_slot_type)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', (
                cid, cal_id, con['day'], con['date'],
                con.get('content_type','Value Bomb'), con.get('format','Reel'),
                con['hook'], con.get('problem',''), con.get('solution',''),
                con.get('cta',''), con.get('platform','Instagram'),
                con.get('predicted_engagement_percent',2.5),
                con.get('idea_brief',''),
                slot_type,
            ))
            concept_ids.append((cid, con))

        # background captions with progress tracking
        tone = dict(project).get('tone_of_voice','Fun & Relatable')
        _gen_progress[cal_id] = {'done': 0, 'total': len(concept_ids), 'status': 'running'}

        def bg_captions(ids, niche, tone, cal_id):
            for cid, con in ids:
                try:
                    cap = generate_captions_with_claude(
                        con['hook'], con.get('problem',''), con.get('solution',''),
                        con.get('cta',''), niche, tone, con.get('content_type','Value Bomb'))
                    for cp in cap.get('captions',[]):
                        execute_db('INSERT INTO captions (id,concept_id,variation_number,text) VALUES (?,?,?,?)',
                                   (str(uuid.uuid4()), cid, cp['number'], cp['text']))
                    for i, tag in enumerate(cap.get('hashtags',[])[:15]):
                        vol = 'high' if i<5 else 'mid' if i<10 else 'niche'
                        execute_db('INSERT INTO hashtags (id,concept_id,tag,volume_level) VALUES (?,?,?,?)',
                                   (str(uuid.uuid4()), cid, tag, vol))
                except Exception:
                    pass
                finally:
                    _gen_progress[cal_id]['done'] = _gen_progress[cal_id].get('done', 0) + 1
            _gen_progress[cal_id]['status'] = 'done'

        threading.Thread(target=bg_captions, args=(concept_ids, dict(project)['niche'], tone, cal_id), daemon=True).start()

        execute_db('INSERT INTO activity_feed (id,project_id,actor,action,target) VALUES (?,?,?,?,?)',
                   (str(uuid.uuid4()), client_id, 'AI', 'generated calendar',
                    f'{len(concepts)} concepts for {calendar_data["start_date"][:7]}'))

        return jsonify({'calendar_id':cal_id,'concepts':len(concepts),'status':'generated','captions_status':'generating'})

    except ValueError as e:
        return jsonify({'error':str(e)}),400
    except Exception as e:
        err = str(e)
        if '401' in err or 'authentication' in err.lower():
            return jsonify({'error':'Invalid API key. Check Settings.'}),400
        return jsonify({'error':f'Generation failed: {err}'}),500

@app.route('/api/calendars/<cal_id>')
def get_calendar(cal_id):
    cal = query_db('SELECT * FROM calendars WHERE id=?',(cal_id,),one=True)
    if not cal:
        return jsonify({'error':'Not found'}),404
    data = dict(cal)
    concepts = query_db('SELECT * FROM concepts WHERE calendar_id=? ORDER BY day',(cal_id,))
    data['concepts'] = []
    for con in concepts:
        cd = dict(con)
        cd['captions']  = [dict(x) for x in query_db('SELECT * FROM captions WHERE concept_id=?',(con['id'],))]
        cd['hashtags']  = [dict(x) for x in query_db('SELECT * FROM hashtags WHERE concept_id=?',(con['id'],))]
        cd['comments']  = [dict(x) for x in query_db('SELECT * FROM comments WHERE concept_id=? ORDER BY created_at',(con['id'],))]
        cd['metrics']   = dict(query_db('SELECT * FROM metrics WHERE concept_id=?',(con['id'],),one=True) or {})
        data['concepts'].append(cd)
    return jsonify(data)

# Concepts
@app.route('/api/concepts/<concept_id>', methods=['PUT'])
def update_concept(concept_id):
    data = request.json
    allowed = ['status','assigned_to','assignee_id','priority','notes','daily_budget',
               'finished_at','is_overdue','boost_status','boost_notes','verification_status']
    fields, values = [], []
    for k in allowed:
        if k in data:
            fields.append(f'{k}=?')
            values.append(data[k])
    if fields:
        values.append(concept_id)
        execute_db(f"UPDATE concepts SET {','.join(fields)} WHERE id=?", values)
    # log
    if 'status' in data:
        con = query_db('SELECT calendar_id FROM concepts WHERE id=?',(concept_id,),one=True)
        if con:
            cal = query_db('SELECT client_id FROM calendars WHERE id=?',(con['calendar_id'],),one=True)
            if cal:
                execute_db('INSERT INTO activity_feed (id,project_id,actor,action,target) VALUES (?,?,?,?,?)',
                           (str(uuid.uuid4()), cal['client_id'], data.get('actor','Team'),
                            f'moved to {data["status"]}', f'Day concept'))
    return jsonify({'status':'updated'})

@app.route('/api/concepts/<concept_id>', methods=['DELETE'])
def delete_concept(concept_id):
    """Delete a single concept and all its related data."""
    execute_db('DELETE FROM captions   WHERE concept_id=?', (concept_id,))
    execute_db('DELETE FROM hashtags   WHERE concept_id=?', (concept_id,))
    execute_db('DELETE FROM comments   WHERE concept_id=?', (concept_id,))
    execute_db('DELETE FROM metrics    WHERE concept_id=?', (concept_id,))
    execute_db('DELETE FROM tasks      WHERE concept_id=?', (concept_id,))
    execute_db('DELETE FROM task_timers WHERE concept_id=?',(concept_id,))
    execute_db('DELETE FROM concepts   WHERE id=?',         (concept_id,))
    return jsonify({'status': 'deleted', 'id': concept_id})

# Comments
@app.route('/api/concepts/<concept_id>/comments', methods=['GET','POST'])
def concept_comments(concept_id):
    if request.method == 'GET':
        rows = query_db('SELECT * FROM comments WHERE concept_id=? ORDER BY created_at',(concept_id,))
        return jsonify([dict(r) for r in rows])
    data   = request.json
    cmt_id = str(uuid.uuid4())
    execute_db('INSERT INTO comments (id,concept_id,author,text) VALUES (?,?,?,?)',
               (cmt_id, concept_id, data.get('author','Anonymous'), data.get('text','')))
    return jsonify({'id':cmt_id,'status':'added'})

@app.route('/api/comments/<cmt_id>', methods=['DELETE'])
def delete_comment(cmt_id):
    role = session.get('user', {}).get('role', 'worker')
    if role != 'admin':
        return jsonify({'error': 'Only admins can delete comments'}), 403
    execute_db('DELETE FROM comments WHERE id=?', (cmt_id,))
    return jsonify({'status': 'deleted'})

# ═══════════════════════════════════════════════════════════════════════════════
#  USER MANAGEMENT  (admin only)
# ═══════════════════════════════════════════════════════════════════════════════
@app.route('/api/users', methods=['GET'])
def list_users():
    role = session.get('user', {}).get('role', 'worker')
    if role != 'admin':
        return jsonify({'error': 'Forbidden'}), 403
    rows = query_db('SELECT id,email,name,picture,role,created_at,last_login FROM users ORDER BY created_at')
    return jsonify([dict(r) for r in rows])

@app.route('/api/heartbeat', methods=['POST'])
def heartbeat():
    """Update current user's last_seen timestamp — called every 30s from frontend."""
    user = session.get('user')
    if not user:
        return jsonify({'ok': False}), 401
    execute_db('UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=?', (user['id'],))
    return jsonify({'ok': True})

@app.route('/api/presence', methods=['GET'])
def presence():
    """Return all users with online/away/offline status. Manager+ only."""
    user = session.get('user', {})
    if user.get('role') not in ('admin', 'manager'):
        return jsonify({'error': 'Forbidden'}), 403
    rows = query_db('''
        SELECT id, email, name, picture, role, last_seen, last_login
        FROM users ORDER BY last_seen DESC NULLS LAST
    ''')
    result = []
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    for r in rows:
        d = dict(r)
        # Determine status from last_seen
        ls = d.get('last_seen')
        if ls:
            try:
                ts = datetime.fromisoformat(ls.replace('Z','+00:00'))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                diff = (now - ts).total_seconds()
                if diff < 120:
                    d['status'] = 'online'
                elif diff < 600:
                    d['status'] = 'away'
                else:
                    d['status'] = 'offline'
                d['last_seen_ago'] = int(diff)
            except Exception:
                d['status'] = 'offline'
                d['last_seen_ago'] = None
        else:
            d['status'] = 'offline'
            d['last_seen_ago'] = None
        result.append(d)
    return jsonify(result)

# ── Team Chat ─────────────────────────────────────────────────────────────────
@app.route('/api/chat', methods=['GET'])
def get_chat():
    user = session.get('user')
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    since = request.args.get('since', 0, type=int)  # message ID cursor
    if since:
        rows = query_db('SELECT * FROM team_chat WHERE id > ? ORDER BY id ASC LIMIT 50', (since,))
    else:
        rows = query_db('SELECT * FROM team_chat ORDER BY id DESC LIMIT 60')
        rows = list(reversed(rows))
    return jsonify([dict(r) for r in rows])

@app.route('/api/chat', methods=['POST'])
def post_chat():
    user = session.get('user')
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.json or {}
    msg  = (data.get('message') or '').strip()
    if not msg or len(msg) > 1000:
        return jsonify({'error': 'Invalid message'}), 400
    execute_db(
        'INSERT INTO team_chat (user_id, user_name, user_role, message) VALUES (?,?,?,?)',
        (user['id'], user.get('name', user.get('email','?')), user.get('role','worker'), msg)
    )
    row = query_db('SELECT * FROM team_chat WHERE rowid=last_insert_rowid()', one=True)
    return jsonify(dict(row) if row else {'ok': True})

@app.route('/api/chat/<int:msg_id>', methods=['DELETE'])
def delete_chat(msg_id):
    user = session.get('user')
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    row = query_db('SELECT * FROM team_chat WHERE id=?', (msg_id,), one=True)
    if not row:
        return jsonify({'error': 'Not found'}), 404
    # Only sender or admin can delete
    if row['user_id'] != user['id'] and user.get('role') != 'admin':
        return jsonify({'error': 'Forbidden'}), 403
    execute_db('DELETE FROM team_chat WHERE id=?', (msg_id,))
    return jsonify({'ok': True})

@app.route('/api/users/<uid>/role', methods=['PATCH'])
def update_user_role(uid):
    role = session.get('user', {}).get('role', 'worker')
    if role != 'admin':
        return jsonify({'error': 'Forbidden'}), 403
    new_role = (request.json or {}).get('role', 'worker')
    if new_role not in ('admin', 'manager', 'executive', 'worker'):
        return jsonify({'error': 'Invalid role'}), 400
    execute_db('UPDATE users SET role=? WHERE id=?', (new_role, uid))
    # Refresh session if editing self
    current = session.get('user', {})
    if current.get('id') == uid:
        current['role'] = new_role
        session['user'] = current
    return jsonify({'status': 'updated', 'role': new_role})

# ═══════════════════════════════════════════════════════════════════════════════
#  INVITE  (admin + manager)
# ═══════════════════════════════════════════════════════════════════════════════
@app.route('/api/invite', methods=['POST'])
def create_invite():
    req_role = session.get('user', {}).get('role', 'worker')
    if req_role not in ('admin', 'manager'):
        return jsonify({'error': 'Forbidden'}), 403
    data     = request.json or {}
    token    = str(uuid.uuid4()).replace('-','')[:24]
    inv_id   = str(uuid.uuid4())
    app_role = data.get('app_role', 'worker')
    if app_role not in ('admin', 'manager', 'executive', 'worker'):
        app_role = 'worker'
    # Managers cannot create admin/manager invites
    if req_role == 'manager' and app_role in ('admin', 'manager'):
        app_role = 'executive'
    execute_db(
        'INSERT INTO invites (id,token,email,phone,name,app_role,invited_by,client_id) VALUES (?,?,?,?,?,?,?,?)',
        (inv_id, token, data.get('email',''), data.get('phone',''),
         data.get('name',''), app_role,
         session.get('user',{}).get('email',''), data.get('client_id',''))
    )
    base = request.host_url.rstrip('/')
    invite_url = f'{base}/join/{token}'
    # Optionally send WhatsApp if phone + Twilio configured
    phone = data.get('phone','').strip()
    sent_via = None
    if phone:
        try:
            import importlib
            twilio_sid  = get_setting('twilio_account_sid')
            twilio_auth = get_setting('twilio_auth_token')
            twilio_from = get_setting('twilio_whatsapp_number')
            if twilio_sid and twilio_auth and twilio_from:
                from twilio.rest import Client as TwilioClient
                tc = TwilioClient(twilio_sid, twilio_auth)
                msg_body = (f"Hi {data.get('name','there')} 👋  You've been invited to ContentFlow!\n"
                            f"Click to join: {invite_url}\nYour role: {app_role.title()}")
                tc.messages.create(body=msg_body,
                                   from_=f'whatsapp:{twilio_from}',
                                   to=f'whatsapp:{phone}')
                sent_via = 'whatsapp'
        except Exception:
            pass
    return jsonify({'status': 'created', 'invite_url': invite_url,
                    'token': token, 'sent_via': sent_via, 'app_role': app_role})

@app.route('/join/<token>')
def join_via_invite(token):
    invite = query_db('SELECT * FROM invites WHERE token=? AND used=0', (token,), one=True)
    if not invite:
        return redirect('/login?error=Invalid+or+expired+invite+link')
    # Store invite token in session so login flow picks it up
    session['pending_invite'] = token
    return redirect('/login?invite=1')

@app.route('/api/invite/accept', methods=['POST'])
def accept_invite():
    token  = (request.json or {}).get('token') or session.get('pending_invite')
    invite = query_db('SELECT * FROM invites WHERE token=? AND used=0', (token,), one=True)
    if not invite:
        return jsonify({'error': 'Invalid invite'}), 400
    user   = session.get('user')
    if not user:
        return jsonify({'error': 'Not logged in'}), 401
    # Assign invited role
    execute_db('UPDATE users SET role=? WHERE id=?', (invite['app_role'], user['id']))
    execute_db('UPDATE invites SET used=1 WHERE token=?', (token,))
    user['role'] = invite['app_role']
    session['user'] = user
    session.pop('pending_invite', None)
    return jsonify({'status': 'accepted', 'role': invite['app_role']})

# Tasks
@app.route('/api/tasks', methods=['GET','POST'])
def manage_tasks():
    if request.method == 'GET':
        status = request.args.get('status')
        project= request.args.get('project_id')
        q = '''SELECT t.*,c.hook,c.content_type,c.format,c.day,c.platform,c.status as concept_status,
                      cal.client_id
               FROM tasks t
               JOIN concepts c ON t.concept_id=c.id
               JOIN calendars cal ON c.calendar_id=cal.id'''
        args = []
        conds = []
        if status:
            conds.append('t.status=?'); args.append(status)
        if project:
            conds.append('cal.client_id=?'); args.append(project)
        if conds:
            q += ' WHERE ' + ' AND '.join(conds)
        q += ' ORDER BY t.created_at DESC'
        rows = query_db(q, args)
        return jsonify([dict(r) for r in rows])
    data = request.json
    tid  = str(uuid.uuid4())
    execute_db('INSERT INTO tasks (id,concept_id,assigned_to,employee_id,status,priority,due_date) VALUES (?,?,?,?,?,?,?)',
               (tid, data['concept_id'], data.get('assigned_to',''), data.get('employee_id',''),
                data.get('status','todo'), data.get('priority','medium'), data.get('due_date','')))
    return jsonify({'id':tid,'status':'created'})

@app.route('/api/tasks/<task_id>', methods=['PUT'])
def update_task(task_id):
    data = request.json
    allowed = ['status','assigned_to','priority','due_date','employee_id']
    fields, values = [], []
    for k in allowed:
        if k in data:
            fields.append(f'{k}=?')
            values.append(data[k])
    if fields:
        # set timestamps
        s = data.get('status','')
        if s == 'submitted':   fields.append('submitted_at=CURRENT_TIMESTAMP')
        if s == 'approved':    fields.append('approved_at=CURRENT_TIMESTAMP')
        if s == 'published':   fields.append('published_at=CURRENT_TIMESTAMP')
        values.append(task_id)
        execute_db(f"UPDATE tasks SET {','.join(fields)} WHERE id=?", values)
    return jsonify({'status':'updated'})

# Team (global)
@app.route('/api/team', methods=['GET','POST'])
def manage_team():
    if request.method == 'GET':
        cid = request.args.get('client_id')
        if cid:
            rows = query_db('SELECT * FROM team_members WHERE client_id=?',(cid,))
        else:
            rows = query_db('SELECT * FROM team_members ORDER BY created_at')
        return jsonify([dict(r) for r in rows])
    data = request.json
    mid  = str(uuid.uuid4())
    colors = ['#667eea','#f59e0b','#10b981','#ef4444','#3b82f6','#8b5cf6','#ec4899']
    color  = colors[len(query_db('SELECT id FROM team_members')) % len(colors)]
    execute_db('INSERT INTO team_members (id,name,role,client_id,email,avatar_color) VALUES (?,?,?,?,?,?)',
               (mid, data.get('name',''), data.get('role',''), data.get('client_id',''), data.get('email',''), color))
    return jsonify({'id':mid,'status':'added'})

# Milestones
@app.route('/api/milestones', methods=['POST'])
def create_milestone():
    data = request.json
    mid  = str(uuid.uuid4())
    execute_db('INSERT INTO milestones (id,project_id,title,due_date) VALUES (?,?,?,?)',
               (mid, data['project_id'], data.get('title',''), data.get('due_date','')))
    return jsonify({'id':mid,'status':'created'})

@app.route('/api/milestones/<mid>', methods=['PUT','DELETE'])
def update_milestone(mid):
    if request.method == 'DELETE':
        execute_db('DELETE FROM milestones WHERE id=?',(mid,))
        return jsonify({'status':'deleted'})
    data = request.json
    execute_db('UPDATE milestones SET completed=? WHERE id=?',(int(data.get('completed',0)),mid))
    return jsonify({'status':'updated'})

# Analytics
@app.route('/api/analytics/<client_id>')
def get_analytics(client_id):
    concepts = query_db('''SELECT c.id,c.content_type,c.hook,c.day FROM concepts c
                           JOIN calendars cal ON c.calendar_id=cal.id
                           WHERE cal.client_id=?''',(client_id,))
    perf = []
    for con in concepts:
        m = query_db('SELECT * FROM metrics WHERE concept_id=?',(con['id'],),one=True)
        if m:
            perf.append({**dict(con),**dict(m)})
    by_type = {}
    for p in perf:
        t = p.get('content_type','Unknown')
        if t not in by_type:
            by_type[t] = {'views':0,'engagement':0,'count':0}
        by_type[t]['views']      += p.get('views',0)
        by_type[t]['engagement'] += p.get('engagement_rate',0)
        by_type[t]['count']      += 1
    return jsonify({'performance':perf,'by_type':by_type})

# Settings
@app.route('/api/settings', methods=['GET','POST'])
def manage_settings():
    if request.method == 'GET':
        api_key = get_setting("anthropic_api_key") or ""
        env_key = os.environ.get("ANTHROPIC_API_KEY") or ""
        return jsonify({
            'api_key_set':     bool(api_key or env_key),
            'api_key_source':  'environment' if env_key else ('database' if api_key else 'none'),
            'api_key_preview': ('sk-ant-...' + (api_key or env_key)[-4:]) if (api_key or env_key) else '',
        })
    data    = request.json
    api_key = data.get('api_key','').strip()
    if not api_key:
        return jsonify({'error':'API key cannot be empty'}),400
    if not api_key.startswith('sk-ant-'):
        return jsonify({'error':'Invalid format. Key must start with sk-ant-'}),400
    execute_db('''INSERT INTO settings (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
                  ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP''',
               ('anthropic_api_key', api_key))
    os.environ['ANTHROPIC_API_KEY'] = api_key
    return jsonify({'status':'saved','message':'API key saved!'})

@app.route('/api/settings/test')
def test_api_key():
    try:
        get_claude_client().messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=10,
            messages=[{"role":"user","content":"Hi"}])
        return jsonify({'status':'valid','message':'Connected! AI generation is ready.'})
    except ValueError:
        return jsonify({'status':'missing','message':'No API key saved. Enter your key in Settings.'})
    except Exception as e:
        err = str(e)
        if '401' in err or 'authentication' in err.lower():
            return jsonify({'status':'invalid','message':'Invalid API key. Check console.anthropic.com → API Keys.'})
        return jsonify({'status':'error','message':f'Connection error: {err}'})

# AI Extract Project Fields
@app.route('/api/ai/questions', methods=['POST'])
def ai_questions():
    text = (request.json or {}).get('text', '').strip()
    if not text:
        return jsonify({'error': 'No description provided'}), 400
    api_key = os.environ.get("ANTHROPIC_API_KEY") or get_setting("anthropic_api_key")
    if not api_key:
        return jsonify({'error': 'API key not set. Go to Settings first.'}), 400
    try:
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=350,
            messages=[{"role": "user", "content": f"""You are ContentFlow's AI assistant helping set up a content calendar project.

A user described their business: "{text}"

Ask them exactly 3 follow-up questions to clarify the content strategy before building their project. Make the questions specific to their niche — reference their actual business.

Questions must cover:
1. What SPECIFIC value bombs / content they'll deliver (give 3-4 niche-specific examples as suggestions)
2. Which sub-niche or topic angle to focus on (give 2-3 specific options relevant to their business)
3. Campaign length: 10, 30, or 60 days — and why each might suit them

Be conversational, warm, and specific. Start with a one-line acknowledgement of their business. Keep total under 180 words. Number the questions 1, 2, 3."""}]
        )
        return jsonify({'message': msg.content[0].text})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/ai/extract', methods=['POST'])
def ai_extract():
    text = (request.json or {}).get('text', '').strip()
    if not text:
        return jsonify({'error': 'No description provided'}), 400
    api_key = os.environ.get("ANTHROPIC_API_KEY") or get_setting("anthropic_api_key")
    if not api_key:
        return jsonify({'error': 'API key not set. Go to Settings first.'}), 400
    try:
        prompt = f"""You are a business analyst. Extract structured project details from this description.
Return ONLY valid JSON — no markdown, no explanation.

Description: {text}

JSON schema (use null for fields not mentioned, make smart inferences for the rest):
{{
  "name": "client or brand name",
  "niche": "specific niche/industry",
  "business_type": "type of business",
  "goal": "primary business goal",
  "emoji": "one relevant emoji",
  "target_age": "age range like 25-35",
  "target_gender": "All / Mostly Male / Mostly Female",
  "target_location": "city/region",
  "target_interests": "interests and lifestyle in 1-2 sentences",
  "target_pain_points": "what problems the audience faces, 1-2 sentences",
  "unique_selling_point": "what makes this brand unique",
  "competitor_handles": "competitor social handles if mentioned",
  "brand_colors": "color palette or aesthetic",
  "tone_of_voice": "one of: Fun & Relatable | Professional & Authoritative | Inspirational & Motivational | Casual & Conversational | Bold & Edgy | Luxury & Premium | Educational & Informative",
  "campaign_days": 30,
  "goal_type": "followers or sales",
  "value_bomb_types": ["pick 3 from: Value Bomb, Carousel Tutorial, Free PDF Bomb, Template Drop, Secret Video, Tutorial Reel, Q&A Bomb, Behind the Scenes"],
  "confidence_notes": "one sentence on what you inferred vs what was stated"
}}"""
        msg = get_claude_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=900,
            messages=[{"role": "user", "content": prompt}]
        )
        txt = msg.content[0].text
        s, e = txt.find('{'), txt.rfind('}')+1
        data = json.loads(txt[s:e])
        return jsonify(data)
    except ValueError as ex:
        return jsonify({'error': str(ex)}), 400
    except Exception as ex:
        return jsonify({'error': f'AI extraction failed: {str(ex)}'}), 500


# AI General Chat
@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    body    = request.json or {}
    message = body.get('message', '').strip()
    history = body.get('history', [])   # [{role, content}, ...]
    context = body.get('context', '')   # project name/niche
    if not message:
        return jsonify({'error': 'Empty message'}), 400
    api_key = os.environ.get("ANTHROPIC_API_KEY") or get_setting("anthropic_api_key")
    if not api_key:
        return jsonify({'error': 'API key not set'}), 400
    try:
        system = """You are ContentFlow AI — an expert social media content strategist built into ContentFlow.
Help with: content strategy, hooks, captions, hashtags, campaign planning, posting schedules, audience growth, Godfather offers, value bombs.
Be concise, actionable, and specific. Use bullet points for lists. Keep replies under 200 words unless asked for more."""
        if context:
            system += f"\n\nCurrent project context: {context}"
        messages = history[-10:]  # keep last 10 turns for context
        messages.append({"role": "user", "content": message})
        resp = get_claude_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            system=system,
            messages=messages
        )
        return jsonify({'reply': resp.content[0].text})
    except ValueError as ex:
        return jsonify({'error': str(ex)}), 400
    except Exception as ex:
        return jsonify({'error': f'Chat error: {str(ex)}'}), 500


# ── Competitor Finder (Apify) ─────────────────────────────────────────────────
@app.route('/api/competitors/find', methods=['POST'])
def find_competitors():
    body     = request.json or {}
    niche    = body.get('niche', '').strip()
    location = body.get('location', '').strip()
    if not niche:
        return jsonify({'error': 'Niche is required'}), 400
    apify_key = get_setting('apify_api_key')
    if not apify_key:
        return jsonify({'error': 'Apify API key not set. Add it in Settings → Integrations.'}), 400
    try:
        tag = ''.join(c for c in niche.lower() if c.isalnum())[:25]
        loc_tag = ''.join(c for c in location.lower() if c.isalnum())[:20] if location else ''
        hashtags = [h for h in [tag, loc_tag + tag[:15] if loc_tag else '', loc_tag] if h][:2]

        payload = json.dumps({'hashtags': hashtags, 'resultsLimit': 40}).encode()
        url = f'https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/run-sync-get-dataset-items?token={apify_key}&timeout=45'
        req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=50) as resp:
            items = json.loads(resp.read().decode())

        accounts = {}
        for item in items:
            uname = (item.get('ownerUsername') or item.get('owner', {}).get('username') or item.get('username') or '')
            if not uname:
                continue
            followers = (item.get('ownerFollowersCount') or item.get('owner', {}).get('followersCount') or 0)
            if uname not in accounts or followers > accounts[uname]['followers']:
                accounts[uname] = {
                    'handle': '@' + uname, 'platform': 'Instagram',
                    'followers': followers,
                    'bio': (item.get('ownerBio') or item.get('biography') or '')[:120],
                    'url': f'https://instagram.com/{uname}'
                }
        top = sorted(accounts.values(), key=lambda x: x['followers'], reverse=True)[:5]
        return jsonify({'competitors': top, 'count': len(top)})
    except urllib.error.HTTPError as e:
        return jsonify({'error': f'Apify API error {e.code}: check API key and quota'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Email System ──────────────────────────────────────────────────────────────
def send_email_internal(to_email, subject, html_body, text_body=None):
    smtp_host = get_setting('smtp_host') or ''
    smtp_port = int(get_setting('smtp_port') or 587)
    smtp_user = get_setting('smtp_user') or ''
    smtp_pass = get_setting('smtp_password') or ''
    from_name = get_setting('smtp_from_name') or 'ContentFlow'
    from_addr = get_setting('smtp_from') or smtp_user
    if not smtp_host or not smtp_user:
        raise ValueError('Email not configured. Go to Settings → Email.')
    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From']    = f'{from_name} <{from_addr}>'
    msg['To']      = to_email
    if text_body:
        msg.attach(MIMEText(text_body, 'plain'))
    msg.attach(MIMEText(html_body, 'html'))
    ctx = ssl.create_default_context()
    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as s:
        s.ehlo(); s.starttls(context=ctx); s.login(smtp_user, smtp_pass)
        s.sendmail(from_addr, to_email, msg.as_string())

EMAIL_STYLE = 'font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;'
BTN_STYLE   = 'display:inline-block;margin-top:16px;background:#6366f1;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:600;'

@app.route('/api/settings/email', methods=['GET', 'POST'])
def email_settings_api():
    if request.method == 'GET':
        return jsonify({
            'smtp_host': get_setting('smtp_host') or '',
            'smtp_port': get_setting('smtp_port') or '587',
            'smtp_user': get_setting('smtp_user') or '',
            'smtp_from': get_setting('smtp_from') or '',
            'smtp_from_name': get_setting('smtp_from_name') or 'ContentFlow',
            'configured': bool(get_setting('smtp_host') and get_setting('smtp_user'))
        })
    body = request.json or {}
    for k in ['smtp_host','smtp_port','smtp_user','smtp_password','smtp_from','smtp_from_name']:
        if k in body:
            set_setting(k, body[k])
    return jsonify({'message': 'Email settings saved'})

@app.route('/api/settings/email/test', methods=['POST'])
def test_email_api():
    to = (request.json or {}).get('to_email') or get_setting('smtp_user')
    if not to:
        return jsonify({'error': 'Provide a recipient email'}), 400
    try:
        send_email_internal(to, 'ContentFlow — Test Email ✅',
            f'<div style="{EMAIL_STYLE}"><h2 style="color:#6366f1;">✅ Email is working!</h2><p>Your ContentFlow email settings are configured correctly.</p></div>')
        return jsonify({'message': f'Test email sent to {to}'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/settings/integrations', methods=['GET', 'POST'])
def integrations_api():
    if request.method == 'GET':
        key = get_setting('apify_api_key') or ''
        return jsonify({'apify_api_key': ('*' * 8 + key[-4:]) if len(key) > 8 else '', 'apify_configured': bool(key)})
    body = request.json or {}
    if 'apify_api_key' in body and body['apify_api_key'] and not body['apify_api_key'].startswith('*'):
        set_setting('apify_api_key', body['apify_api_key'])
    return jsonify({'message': 'Integration settings saved'})

# Task email notifications
def notify_assigned_bg(to_email, hook, project_name, assignee_name):
    threading.Thread(target=lambda: _send_assigned(to_email, hook, project_name, assignee_name), daemon=True).start()

def _send_assigned(to_email, hook, project_name, assignee_name):
    try:
        send_email_internal(to_email, f'[ContentFlow] Task assigned — {project_name}',
            f'<div style="{EMAIL_STYLE}"><h2 style="color:#6366f1;">📋 New Task Assigned</h2>'
            f'<p>Hi {assignee_name}, you have a new task in <strong>{project_name}</strong>:</p>'
            f'<div style="background:#eef2ff;border-left:4px solid #6366f1;padding:16px;margin:16px 0;border-radius:4px;"><strong>{hook}</strong></div>'
            f'<a href="http://localhost:8080" style="{BTN_STYLE}">Open ContentFlow</a></div>')
    except Exception: pass

def notify_completed_bg(all_emails, hook, project_name, done_by):
    for em in all_emails:
        threading.Thread(target=lambda e=em: _send_completed(e, hook, project_name, done_by), daemon=True).start()

def _send_completed(to_email, hook, project_name, done_by):
    try:
        send_email_internal(to_email, f'[ContentFlow] ✅ Done — {project_name}',
            f'<div style="{EMAIL_STYLE}"><h2 style="color:#10b981;">✅ Task Completed</h2>'
            f'<p><strong>{done_by}</strong> completed a task in <strong>{project_name}</strong>:</p>'
            f'<div style="background:#f0fdf4;border-left:4px solid #10b981;padding:16px;margin:16px 0;border-radius:4px;"><strong>{hook}</strong></div>'
            f'<a href="http://localhost:8080" style="{BTN_STYLE}">View Project</a></div>')
    except Exception: pass

# Send daily reminders in background
def _daily_reminders():
    conn = sqlite3.connect(DB_PATH); conn.row_factory = sqlite3.Row
    try:
        members = conn.execute("SELECT DISTINCT name, email FROM team_members WHERE email != '' AND email IS NOT NULL").fetchall()
        for m in members:
            rows = conn.execute('''
                SELECT c.hook, c.date, c.status, cl.name as proj FROM concepts c
                JOIN calendars cal ON c.calendar_id=cal.id
                JOIN clients cl ON cal.client_id=cl.id
                WHERE c.assigned_to=? AND c.status NOT IN ("published","approved")
                ORDER BY c.date ASC LIMIT 8
            ''', (m['name'],)).fetchall()
            if not rows: continue
            tbl = ''.join(f'<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">{r["hook"][:55]}...</td>'
                          f'<td style="padding:8px;border-bottom:1px solid #e5e7eb;">{r["proj"]}</td>'
                          f'<td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#f59e0b;">{r["status"].replace("_"," ")}</td></tr>' for r in rows)
            try:
                send_email_internal(m['email'], f'[ContentFlow] Daily reminder — {len(rows)} tasks pending',
                    f'<div style="{EMAIL_STYLE}"><h2 style="color:#6366f1;">📅 Daily Reminder</h2>'
                    f'<p>Hi {m["name"]}, you have <strong>{len(rows)} pending tasks</strong>:</p>'
                    f'<table style="width:100%;border-collapse:collapse;font-size:14px;">'
                    f'<thead><tr style="background:#f3f4f6;"><th style="padding:8px;text-align:left;">Task</th><th style="padding:8px;text-align:left;">Project</th><th style="padding:8px;text-align:left;">Status</th></tr></thead>'
                    f'<tbody>{tbl}</tbody></table>'
                    f'<a href="http://localhost:8080" style="{BTN_STYLE}">Open ContentFlow</a></div>')
            except Exception: pass
    finally: conn.close()

def _mark_overdue_concepts():
    """Mark unfinished concepts as overdue after midnight Thai time (UTC+7)."""
    try:
        ist_now   = datetime.utcnow() + timedelta(hours=7)
        ist_today = ist_now.strftime('%Y-%m-%d')
        # Concepts whose date < today IST, not finished, not already marked overdue
        rows = query_db(
            "SELECT id FROM concepts WHERE date < ? AND finished_at IS NULL AND (is_overdue IS NULL OR is_overdue=0) AND (verification_status IS NULL OR verification_status NOT IN ('pending','verified'))",
            (ist_today,)
        )
        for r in rows:
            execute_db("UPDATE concepts SET is_overdue=1 WHERE id=?", (r['id'],))
    except Exception:
        pass

def daily_reminder_scheduler():
    while True:
        try:
            now = datetime.now()
            if now.hour == 9 and now.minute < 2:
                _daily_reminders()
                time_module.sleep(120)
            # Overdue check runs every 5 minutes
            _mark_overdue_concepts()
        except Exception: pass
        time_module.sleep(300)

# ── AI Instructions (Canva / HeyGen) ─────────────────────────────────────────
@app.route('/api/ai/instructions', methods=['POST'])
def ai_instructions():
    body = request.json or {}
    fmt  = body.get('format', 'Carousel')   # Carousel or Video/Reel
    hook = body.get('hook', '')
    content_type = body.get('content_type', '')
    niche = body.get('niche', '')
    solution = body.get('solution', '')
    api_key = os.environ.get("ANTHROPIC_API_KEY") or get_setting("anthropic_api_key")
    if not api_key:
        return jsonify({'error': 'API key not set'}), 400
    try:
        client = anthropic.Anthropic(api_key=api_key)
        is_carousel = 'carousel' in fmt.lower() or 'canva' in fmt.lower()
        if is_carousel:
            prompt = f"""Create Canva AI design instructions for this carousel post.
Hook: {hook}
Content type: {content_type}
Niche: {niche}
Solution shown: {solution}

Return a JSON object:
{{
  "slide_count": 7,
  "canva_ai_prompt": "Describe the visual style in one sentence for Canva AI image generation",
  "slides": [
    {{"slide": 1, "type": "Cover", "heading": "...", "subtext": "...", "visual": "describe image/graphic for this slide"}},
    ... all slides
  ],
  "design_notes": "Color, font, style guidance for Canva",
  "canva_template_search": "search term for Canva templates"
}}"""
        else:
            prompt = f"""Create a HeyGen AI video script with voiceover for this content.
Hook: {hook}
Content type: {content_type}
Niche: {niche}
Solution shown: {solution}

Return a JSON object:
{{
  "video_duration": "60-90 seconds",
  "heygen_avatar_style": "Professional / Casual / Energetic",
  "voiceover_script": "Full word-for-word script for the AI avatar to speak",
  "scene_breakdown": [
    {{"scene": 1, "duration": "0-10s", "script": "...", "visual_cue": "what to show on screen"}},
    ... all scenes
  ],
  "background_music": "description of background music vibe",
  "heygen_voice_recommendation": "voice style that fits the tone"
}}"""

        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1200,
            messages=[{"role": "user", "content": prompt}]
        )
        txt = msg.content[0].text
        s, e = txt.find('{'), txt.rfind('}')+1
        data = json.loads(txt[s:e]) if s >= 0 else {'raw': txt}
        data['type'] = 'carousel' if is_carousel else 'video'
        return jsonify(data)
    except Exception as ex:
        return jsonify({'error': str(ex)}), 500

# ── Regenerate idea brief ────────────────────────────────────────────────────
@app.route('/api/concepts/<concept_id>/regenerate', methods=['POST'])
def regenerate_idea(concept_id):
    row = query_db('SELECT * FROM concepts WHERE id=?', (concept_id,), one=True)
    if not row:
        return jsonify({'error': 'Not found'}), 404
    c = dict(row)
    # fetch niche
    niche, tone = '', 'Fun & Relatable'
    cal = query_db('SELECT client_id FROM calendars WHERE id=?', (c['calendar_id'],), one=True)
    if cal:
        proj = query_db('SELECT niche, tone_of_voice FROM clients WHERE id=?', (cal['client_id'],), one=True)
        if proj:
            niche = proj['niche'] or ''
            tone  = proj['tone_of_voice'] or 'Fun & Relatable'
    try:
        client = get_claude_client()
        prompt = f"""You are a social media content expert. Write a detailed content brief for this post.

Hook: {c['hook']}
Content type: {c.get('content_type','')}
Format: {c.get('format','')}
Problem addressed: {c.get('problem','')}
Solution offered: {c.get('solution','')}
CTA: {c.get('cta','')}
Niche: {niche}
Tone: {tone}

Write 3-4 sentences explaining EXACTLY what content to create:
- What specific information, data, or story to include
- What makes this post genuinely valuable (specific tips, real examples, numbers)
- What the viewer should feel/do after seeing it
- Any specific visual or script direction

Be specific to the {niche} industry. No generic advice."""
        msg = client.messages.create(
            model='claude-haiku-4-5-20251001', max_tokens=400,
            messages=[{'role': 'user', 'content': prompt}]
        )
        brief = msg.content[0].text.strip()
        execute_db('UPDATE concepts SET idea_brief=?, image_prompt=NULL, video_prompt=NULL WHERE id=?', (brief, concept_id))
        return jsonify({'idea_brief': brief})
    except Exception as ex:
        return jsonify({'error': str(ex)}), 500

# ── Caption generation progress ──────────────────────────────────────────────
@app.route('/api/calendars/<cal_id>/progress')
def calendar_progress(cal_id):
    prog = _gen_progress.get(cal_id, {'done': 0, 'total': 0, 'status': 'unknown'})
    return jsonify(prog)

# ── Concept creative (image prompt + video prompt, cached) ────────────────────
@app.route('/api/concepts/<concept_id>/creative', methods=['GET'])
def concept_creative(concept_id):
    row = query_db('SELECT * FROM concepts WHERE id=?', (concept_id,), one=True)
    if not row:
        return jsonify({'error': 'Not found'}), 404
    c = dict(row)
    # Competitor reverse-engineer slots: return empty (no generation)
    _fmt_low = (c.get('format','') or '').lower()
    _ct_low  = (c.get('content_type','') or '').lower()
    _hook_low = (c.get('hook','') or '').lower()
    if 'competitor' in _fmt_low or 'competitor' in _ct_low or 'reverse engineer' in _fmt_low or 'spy' in _hook_low:
        return jsonify({'image_prompt': None, 'video_prompt': None, 'cached': True, 'competitor_slot': True})
    if c.get('image_prompt') and c.get('video_prompt'):
        try: img_cached = json.loads(c['image_prompt'])
        except: img_cached = c['image_prompt']
        try: vid_cached = json.loads(c['video_prompt'])
        except: vid_cached = c['video_prompt']
        return jsonify({'image_prompt': img_cached, 'video_prompt': vid_cached, 'cached': True})
    # fetch niche for context
    niche = ''
    cal = query_db('SELECT client_id FROM calendars WHERE id=?', (c['calendar_id'],), one=True)
    if cal:
        proj = query_db('SELECT niche, tone_of_voice FROM clients WHERE id=?', (cal['client_id'],), one=True)
        if proj:
            niche = proj['niche']
    lang = request.args.get('lang', 'en')
    lang_instruction = 'Write ALL text content in Thai language.' if lang == 'th' else ''
    try:
        client = get_claude_client()
        is_carousel = 'carousel' in (c.get('format','') or '').lower()

        # ── Image prompt ──────────────────────────────────────────────────────
        if is_carousel:
            img_prompt_req = f"""Create a 5-slide carousel brief for Canva for this social media post.
Hook: {c['hook']}
Problem: {c.get('problem','')}
Solution: {c.get('solution','')}
CTA: {c.get('cta','')}
Niche: {niche}
{lang_instruction}

RULES:
- Every text field = EXACT words the designer pastes into Canva. No placeholders, no descriptions.
- bg_prompt = ONLY the background photo for Canva AI → Magic Media. Real photograph, no text, no graphics.
- Headlines max 7 words. Body max 20 words.

Return ONLY this exact JSON (no markdown, no extra text):
{{
  "slides": [
    {{"card": 1, "type": "Cover", "headline": "EXACT HOOK HEADLINE ALL CAPS", "subheadline": "Exact supporting line max 10 words", "emoji": "🎯", "bg_prompt": "Cinematic photograph of [specific Thai/SE Asian person, age/gender] [specific action] in [specific location with lighting details]. Professional DSLR, no text, no graphics."}},
    {{"card": 2, "type": "Problem", "headline": "EXACT PAIN HEADLINE max 7 words", "body": "Exact 1-2 sentences the audience feels deeply", "emoji": "😤", "bg_prompt": "Photorealistic photograph of [specific scene showing the problem]. Moody lighting. No text."}},
    {{"card": 3, "type": "Solution", "headline": "EXACT SOLUTION HEADLINE max 7 words", "body": "Exact 1-2 sentences — specific steps or result", "emoji": "💡", "bg_prompt": "Bright optimistic photograph of [specific scene showing the solution outcome]. Natural lighting. No text."}},
    {{"card": 4, "type": "Proof", "headline": "EXACT RESULT with specific number", "body": "Exact evidence — include a real-sounding stat or example", "emoji": "📊", "bg_prompt": "Clean professional photograph of [result/success scene]. Studio lighting. No text."}},
    {{"card": 5, "type": "CTA", "headline": "EXACT ACTION HEADLINE max 7 words", "cta": "EXACT CTA BUTTON TEXT max 4 words", "emoji": "🔖", "bg_prompt": "Vibrant energetic photograph of [person taking action / looking excited]. Warm lighting. No text."}}
  ],
  "color_theme": "Exact hex codes: Primary #XXXXXX + Accent #XXXXXX",
  "font_pairing": "Header: [specific font] | Body: [specific font]"
}}"""
        else:
            img_prompt_req = f"""You are a Canva social media designer AND content strategist. Write the complete text content for a social media post about this topic.

Post context:
- Hook: {c['hook']}
- Problem: {c.get('problem','')}
- Solution: {c.get('solution','')}
- CTA: {c.get('cta','')}
- Niche: {niche}
{lang_instruction}

Return ONLY this exact JSON (no markdown, no extra text):
{{
  "canva_bg_prompt": "Cinematic photograph of a real [specific Thai/Southeast Asian person, gender, age 25-40] [specific action tied to the hook] in [specific real location with lighting detail]. Waist-up portrait. Professional DSLR quality. No text, no signs, no graphics.",
  "h1": "HOOK HEADLINE IN ALL CAPS — max 8 words, grabs attention instantly, matches the hook",
  "h2": "Subheadline — the core problem or promise, max 12 words",
  "problem": "Problem statement — the exact pain the audience feels. Conversational. Max 25 words.",
  "solution": "Solution — what they get and how it fixes the problem specifically. Max 25 words.",
  "offer": "Irresistible offer — specific, tangible, hard to say no to. Include a number or result. Max 25 words.",
  "tips": [
    {{"number": "01", "title": "Tip or how-to title — max 6 words", "body": "Exact actionable tip directly related to {c['hook']}. Specific, useful, new information. Max 20 words."}},
    {{"number": "02", "title": "Tip or how-to title — max 6 words", "body": "Exact actionable tip directly related to {c['hook']}. Different angle. Include a stat or specific detail. Max 20 words."}},
    {{"number": "03", "title": "Tip or how-to title — max 6 words", "body": "Exact actionable tip directly related to {c['hook']}. Outcome-focused. Tell them what happens when they do this. Max 20 words."}}
  ],
  "cta": "CTA BUTTON TEXT — action verb first, max 5 words"
}}"""

        img_msg = client.messages.create(model='claude-haiku-4-5-20251001', max_tokens=1400,
                                          messages=[{'role':'user','content': img_prompt_req}])
        img_txt = img_msg.content[0].text.strip()
        s, e = img_txt.find('{'), img_txt.rfind('}')+1
        try:
            img_data = json.loads(img_txt[s:e]) if s >= 0 else {'raw': img_txt}
        except Exception:
            img_data = {'raw': img_txt}

        # ── Video prompt ──────────────────────────────────────────────────────
        if is_carousel:
            vid_prompt_req = f"""Create a HeyGen teaser video script (12 seconds) promoting this carousel post.
Hook: {c['hook']}
Niche: {niche}
{lang_instruction}

Return ONLY this exact JSON (no markdown, no extra text):
{{
  "avatar": "Thai/Southeast Asian [male/female], age 28-38, [smart casual outfit], [specific background with niche-relevant items], warm and approachable expression",
  "duration": "12 seconds",
  "full_script": "Complete 12-second word-for-word script",
  "scenes": [
    {{"scene": 1, "timestamps": "0-3s", "script": "EXACT hook words — grab attention immediately. 1-2 short punchy sentences.", "visual": "Close-up face, direct to camera", "on_screen_text": "Swipe → to see all [X] tips"}},
    {{"scene": 2, "timestamps": "3-9s", "script": "EXACT preview — tease 2-3 specific points from the carousel. Make them WANT to swipe.", "visual": "Medium shot, show excitement, lean in", "on_screen_text": "Slide [emoji] preview text"}},
    {{"scene": 3, "timestamps": "9-12s", "script": "EXACT CTA — tell them to save and share. 1-2 sentences.", "visual": "Point toward screen, smile", "on_screen_text": "Save this ✅"}}
  ],
  "music_style": "Trending upbeat background music",
  "caption_style": "Bold white captions, centered"
}}"""
        else:
            vid_prompt_req = f"""Create a HeyGen AI presenter video script (20 seconds) for this social media reel.
Hook: {c['hook']}
Problem: {c.get('problem','')}
Solution: {c.get('solution','')}
CTA: {c.get('cta','')}
Niche: {niche}
{lang_instruction}

RULES:
- Script must be natural SPOKEN language — how a real person talks, not formal writing
- Each sentence max 10 words — short, punchy, conversational
- Include specific numbers, results, or examples
- Avatar must feel like a real expert in this niche

Return ONLY this exact JSON (no markdown, no extra text):
{{
  "avatar": "Thai/Southeast Asian [male/female], age 28-38, wearing [specific smart casual outfit relevant to {niche}], standing in [specific background: modern office/restaurant/hotel lobby with relevant items visible], warm confident smile, direct eye contact",
  "duration": "20 seconds",
  "full_script": "Complete word-for-word script combining all scenes — natural spoken language",
  "scenes": [
    {{"scene": 1, "timestamps": "0-4s", "script": "EXACT words to say — hook question or bold statement. Max 2 sentences.", "visual": "Close-up face, direct to camera, slight lean forward", "on_screen_text": "Bold text overlay matching the hook"}},
    {{"scene": 2, "timestamps": "4-13s", "script": "EXACT words — deliver the core value. Include a specific example or number. 3-4 short sentences.", "visual": "Medium shot, gesture naturally, show enthusiasm", "on_screen_text": "Key stat or benefit as text overlay"}},
    {{"scene": 3, "timestamps": "13-20s", "script": "EXACT CTA words — tell them exactly what to do. Create urgency. 2 sentences.", "visual": "Close-up, point toward camera, confident nod", "on_screen_text": "CTA text — what to comment/click/save"}}
  ],
  "music_style": "Upbeat [genre] background music, fade out at 18s",
  "caption_style": "Bold white text, black drop shadow, bottom center"
}}"""

        vid_msg = client.messages.create(model='claude-haiku-4-5-20251001', max_tokens=900,
                                          messages=[{'role':'user','content': vid_prompt_req}])
        vid_txt = vid_msg.content[0].text.strip()
        s, e = vid_txt.find('{'), vid_txt.rfind('}')+1
        try:
            vid_data = json.loads(vid_txt[s:e]) if s >= 0 else {'raw': vid_txt}
        except Exception:
            vid_data = {'raw': vid_txt}

        img_json = json.dumps(img_data, ensure_ascii=False)
        vid_json = json.dumps(vid_data, ensure_ascii=False)
        execute_db('UPDATE concepts SET image_prompt=?, video_prompt=? WHERE id=?',
                   (img_json, vid_json, concept_id))
        return jsonify({'image_prompt': img_data, 'video_prompt': vid_data, 'cached': False})
    except Exception as ex:
        return jsonify({'error': str(ex)}), 500

# ── Verify concept (MOD/Owner approval) ──────────────────────────────────────
@app.route('/api/concepts/<concept_id>/verify', methods=['POST'])
def verify_concept(concept_id):
    row = query_db('SELECT id FROM concepts WHERE id=?', (concept_id,), one=True)
    if not row:
        return jsonify({'error': 'Not found'}), 404
    now = datetime.utcnow().isoformat()
    execute_db('UPDATE concepts SET finished_at=?, is_overdue=0, verification_status=? WHERE id=?',
               (now, 'verified', concept_id))
    return jsonify({'ok': True, 'finished_at': now, 'verification_status': 'verified'})

# ── Regenerate creative (clear cached prompts) ────────────────────────────────
@app.route('/api/concepts/<concept_id>/regenerate-creative', methods=['POST'])
def regenerate_creative_endpoint(concept_id):
    execute_db('UPDATE concepts SET image_prompt=NULL, video_prompt=NULL WHERE id=?', (concept_id,))
    return jsonify({'ok': True})

# ── Creative Chat (modify brief via conversation) ─────────────────────────────
@app.route('/api/concepts/<concept_id>/creative-chat', methods=['POST'])
def creative_chat(concept_id):
    body             = request.json or {}
    user_message     = (body.get('message') or '').strip()
    current_content  = body.get('current_content') or {}
    content_type     = body.get('content_type', 'image')   # 'image' or 'video'
    format_          = body.get('format', '')
    history          = body.get('history') or []

    if not user_message:
        return jsonify({'error': 'No message'}), 400

    is_carousel = 'carousel' in format_.lower()
    brief_type  = ('5-slide carousel' if is_carousel else 'single image reel') if content_type == 'image' else 'HeyGen video script'

    system_prompt = f"""You are a creative brief assistant for social media content.
The user has a Canva {brief_type} brief and wants to modify it.

Current brief JSON:
{json.dumps(current_content, ensure_ascii=False, indent=2)}

RULES:
- If the user asks to change/update/modify anything in the brief, return ONLY the complete updated JSON object in EXACTLY the same format/keys as the current brief. No markdown, no explanation, just the JSON.
- If they ask a general question or make a comment that doesn't require a change, reply with a short helpful plain-text answer (max 2 sentences).
- Keep all existing fields and only update what was requested.
- Maintain the same language, style and quality as the current brief.
- JSON must be valid — double-check commas and brackets."""

    messages = []
    for h in (history or [])[-8:]:
        if h.get('role') in ('user', 'assistant') and h.get('content'):
            messages.append({'role': h['role'], 'content': str(h['content'])})
    messages.append({'role': 'user', 'content': user_message})

    try:
        client_obj = get_claude_client()
        resp = client_obj.messages.create(
            model='claude-haiku-4-5-20251001',
            max_tokens=2500,
            system=system_prompt,
            messages=messages
        )
        reply = resp.content[0].text.strip()

        # Strip markdown code fences
        if reply.startswith('```'):
            reply = reply.split('```', 2)[1]
            if reply.startswith('json'): reply = reply[4:]
            reply = reply.rsplit('```', 1)[0].strip()

        # Detect JSON response
        if reply.lstrip().startswith('{'):
            s, e = reply.find('{'), reply.rfind('}') + 1
            raw = reply[s:e]
            try:
                updated = json.loads(raw)
            except json.JSONDecodeError:
                import re as _re
                fixed = _re.sub(r',\s*([\}\]])', r'\1', raw)
                try:
                    updated = json.loads(fixed)
                except Exception:
                    return jsonify({'type': 'text', 'message': reply})
            return jsonify({'type': 'update', 'content': updated, 'message': 'Done! Here\'s your updated brief:'})

        return jsonify({'type': 'text', 'message': reply})

    except Exception as ex:
        return jsonify({'error': str(ex)}), 500


# ── Team suggest (for auto-suggest) ──────────────────────────────────────────
@app.route('/api/team/suggest', methods=['GET'])
def team_suggest():
    q = (request.args.get('q') or '').lower()
    rows = query_db("SELECT DISTINCT name, email, role FROM team_members WHERE email != '' AND email IS NOT NULL ORDER BY name")
    members = [{'name': r['name'], 'email': r['email'], 'role': r['role'] or ''} for r in rows]
    if q:
        members = [m for m in members if q in m['name'].lower() or q in m['email'].lower()]
    return jsonify(members[:8])


# ═══════════════════════════════════════════════════════════════════════════════
#  GOOGLE OAUTH
# ═══════════════════════════════════════════════════════════════════════════════
@app.route('/login')
def login_page():
    if session.get('user'):
        return redirect('/')
    google_client_id = get_setting('google_client_id') or ''
    allow_guest = get_setting('allow_guest_login') or '1'
    error = request.args.get('error', '')
    return render_template('login.html',
        google_configured=bool(google_client_id),
        allow_guest=allow_guest != '0',
        error=error)

@app.route('/auth/google')
def auth_google():
    client_id = get_setting('google_client_id')
    if not client_id:
        return redirect('/login?error=Google+OAuth+not+configured.+Set+Client+ID+in+Admin+Settings.')
    state = _secrets.token_urlsafe(16)
    session['oauth_state'] = state
    params = urllib.parse.urlencode({
        'client_id': client_id,
        'redirect_uri': 'http://localhost:8080/auth/google/callback',
        'response_type': 'code',
        'scope': 'openid email profile',
        'state': state,
        'access_type': 'online',
        'prompt': 'select_account'
    })
    return redirect(f'{GOOGLE_AUTH_URL}?{params}')

@app.route('/auth/google/callback')
def auth_google_callback():
    error = request.args.get('error')
    if error:
        return redirect(f'/login?error={urllib.parse.quote(error)}')
    code  = request.args.get('code', '')
    state = request.args.get('state', '')
    if state != session.get('oauth_state', '___'):
        return redirect('/login?error=Invalid+OAuth+state')
    client_id     = get_setting('google_client_id') or ''
    client_secret = get_setting('google_client_secret') or ''
    token_payload = urllib.parse.urlencode({
        'code': code, 'client_id': client_id, 'client_secret': client_secret,
        'redirect_uri': 'http://localhost:8080/auth/google/callback',
        'grant_type': 'authorization_code'
    }).encode()
    try:
        req = urllib.request.Request(GOOGLE_TOKEN_URL, data=token_payload,
                                     headers={'Content-Type': 'application/x-www-form-urlencoded'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            tokens = json.loads(resp.read().decode())
        access_token = tokens.get('access_token', '')
        req2 = urllib.request.Request(GOOGLE_USERINFO, headers={'Authorization': f'Bearer {access_token}'})
        with urllib.request.urlopen(req2, timeout=10) as resp2:
            uinfo = json.loads(resp2.read().decode())
        email   = uinfo.get('email', '')
        name    = uinfo.get('name', email.split('@')[0])
        picture = uinfo.get('picture', '')
        g_id    = uinfo.get('sub', '')
        existing = query_db('SELECT * FROM users WHERE email=?', (email,), one=True)
        if existing:
            uid  = existing['id']
            role = existing['role']
            execute_db('UPDATE users SET name=?,picture=?,google_id=?,last_login=CURRENT_TIMESTAMP WHERE email=?',
                       (name, picture, g_id, email))
        else:
            uid       = str(uuid.uuid4())
            user_count = query_db('SELECT COUNT(*) as n FROM users')[0]['n']
            role      = 'admin' if user_count == 0 else 'worker'
            execute_db('INSERT INTO users (id,email,name,picture,google_id,role) VALUES (?,?,?,?,?,?)',
                       (uid, email, name, picture, g_id, role))
        session['user'] = {'id': uid, 'email': email, 'name': name, 'picture': picture, 'role': role}
        session.pop('oauth_state', None)
        return redirect('/')
    except Exception as ex:
        return redirect(f'/login?error={urllib.parse.quote(str(ex)[:120])}')

@app.route('/auth/guest')
def auth_guest():
    allow_guest = get_setting('allow_guest_login') or '1'
    if allow_guest == '0':
        return redirect('/login?error=Guest+login+is+disabled')
    session['user'] = {'id': 'guest', 'email': 'guest@local', 'name': 'Guest', 'picture': '', 'role': 'worker'}
    return redirect('/')

@app.route('/auth/email', methods=['POST'])
def auth_email():
    """Email + password login — works for any user with a password_hash set."""
    email    = (request.form.get('email') or '').strip().lower()
    password = request.form.get('password') or ''
    if not email or not password:
        return redirect('/login?error=Please+enter+your+email+and+password')
    user = query_db('SELECT * FROM users WHERE LOWER(email)=?', (email,), one=True)
    if not user:
        return redirect('/login?error=No+account+found+for+that+email')
    ph = user['password_hash'] or ''
    if not ph or not check_password_hash(ph, password):
        return redirect('/login?error=Incorrect+password')
    execute_db('UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?', (user['id'],))
    session['user'] = {
        'id':      user['id'],
        'email':   user['email'],
        'name':    user['name'] or user['email'].split('@')[0],
        'picture': user['picture'] or '',
        'role':    user['role'] or 'worker',
    }
    # Accept pending invite if any
    pending = session.get('pending_invite')
    if pending:
        inv = query_db('SELECT * FROM invites WHERE token=? AND used=0', (pending,), one=True)
        if inv:
            execute_db('UPDATE users SET role=? WHERE id=?', (inv['app_role'], user['id']))
            execute_db('UPDATE invites SET used=1 WHERE token=?', (pending,))
            session['user']['role'] = inv['app_role']
            session.pop('pending_invite', None)
    return redirect('/')

@app.route('/logout')
def logout():
    session.clear()
    return redirect('/login')

@app.route('/api/me', methods=['GET','PATCH'])
def get_me():
    user = session.get('user')
    if request.method == 'GET':
        if user:
            return jsonify(user)
        return jsonify({'id': 'guest', 'email': 'guest@local', 'name': 'Guest', 'picture': '', 'role': 'worker', 'guest': True})
    # PATCH — update own profile (name + optional password)
    if not user:
        return jsonify({'error': 'Not logged in'}), 401
    data = request.json or {}
    updates = []
    params  = []
    if 'name' in data and data['name'].strip():
        updates.append('name=?'); params.append(data['name'].strip())
    if 'password' in data and data['password'].strip():
        from werkzeug.security import generate_password_hash
        updates.append('password_hash=?'); params.append(generate_password_hash(data['password'].strip()))
    if updates:
        params.append(user['id'])
        execute_db(f"UPDATE users SET {', '.join(updates)} WHERE id=?", params)
        # refresh session
        row = query_db('SELECT * FROM users WHERE id=?', (user['id'],), one=True)
        if row:
            u = dict(row)
            u.pop('password_hash', None)
            session['user'] = u
    return jsonify({'status': 'updated'})


# ═══════════════════════════════════════════════════════════════════════════════
#  TASK TIMER + SCREENSHOTS
# ═══════════════════════════════════════════════════════════════════════════════
@app.route('/api/timers', methods=['GET', 'POST'])
def manage_timers():
    if request.method == 'GET':
        client_id  = request.args.get('client_id')
        user_email = request.args.get('user_email')
        if client_id:
            rows = query_db('SELECT * FROM task_timers WHERE client_id=? ORDER BY started_at DESC LIMIT 50', (client_id,))
        elif user_email:
            rows = query_db('SELECT * FROM task_timers WHERE user_email=? ORDER BY started_at DESC LIMIT 50', (user_email,))
        else:
            rows = query_db('SELECT * FROM task_timers ORDER BY started_at DESC LIMIT 100')
        result = []
        for r in rows:
            t = dict(r)
            t['screenshots'] = [dict(s) for s in query_db(
                'SELECT * FROM timer_screenshots WHERE timer_id=? ORDER BY captured_at', (t['id'],))]
            result.append(t)
        return jsonify(result)

    data      = request.json or {}
    timer_id  = str(uuid.uuid4())
    user_info = session.get('user', {'email': 'guest@local'})
    execute_db('''INSERT INTO task_timers (id,user_email,concept_id,client_id,task_name,status)
                  VALUES (?,?,?,?,?,?)''',
               (timer_id, user_info.get('email','guest@local'),
                data.get('concept_id',''), data.get('client_id',''),
                data.get('task_name','Work Session'), 'running'))
    return jsonify({'id': timer_id, 'status': 'running'})

@app.route('/api/timers/<timer_id>', methods=['GET','PUT','DELETE'])
def timer_detail(timer_id):
    if request.method == 'GET':
        row = query_db('SELECT * FROM task_timers WHERE id=?', (timer_id,), one=True)
        if not row:
            return jsonify({'error': 'Not found'}), 404
        t = dict(row)
        t['screenshots'] = [dict(s) for s in query_db(
            'SELECT * FROM timer_screenshots WHERE timer_id=? ORDER BY captured_at', (timer_id,))]
        return jsonify(t)
    if request.method == 'DELETE':
        execute_db('DELETE FROM timer_screenshots WHERE timer_id=?', (timer_id,))
        execute_db('DELETE FROM task_timers WHERE id=?', (timer_id,))
        return jsonify({'status': 'deleted'})
    data   = request.json or {}
    status = data.get('status')
    dur    = data.get('duration_seconds')
    notes  = data.get('notes')
    fields, values = [], []
    if status:
        fields.append('status=?'); values.append(status)
        if status == 'stopped': fields.append('stopped_at=CURRENT_TIMESTAMP')
    if dur is not None:
        fields.append('duration_seconds=?'); values.append(int(dur))
    if notes:
        fields.append('notes=?'); values.append(notes)
    if fields:
        values.append(timer_id)
        execute_db(f"UPDATE task_timers SET {','.join(fields)} WHERE id=?", values)
    return jsonify({'status': 'updated'})

@app.route('/api/timers/<timer_id>/screenshot', methods=['POST'])
def take_screenshot(timer_id):
    row = query_db('SELECT id FROM task_timers WHERE id=?', (timer_id,), one=True)
    if not row:
        return jsonify({'error': 'Timer not found'}), 404
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
    ts       = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f'cf_screen_{ts}.png'
    filepath = os.path.join(SCREENSHOTS_DIR, filename)
    try:
        try:
            from PIL import ImageGrab
            img = ImageGrab.grab()
        except ImportError:
            import pyautogui
            img = pyautogui.screenshot()
        img.save(filepath, 'PNG')
        shot_id = str(uuid.uuid4())
        execute_db('INSERT INTO timer_screenshots (id,timer_id,filepath,filename) VALUES (?,?,?,?)',
                   (shot_id, timer_id, filepath, filename))
        return jsonify({'id': shot_id, 'filename': filename,
                        'url': f'/api/screenshots/{shot_id}', 'status': 'captured'})
    except ImportError:
        return jsonify({'error': 'Install Pillow: pip install Pillow'}), 500
    except Exception as ex:
        return jsonify({'error': f'Screenshot failed: {str(ex)}'}), 500

@app.route('/api/screenshots/<shot_id>')
def serve_screenshot(shot_id):
    row = query_db('SELECT * FROM timer_screenshots WHERE id=?', (shot_id,), one=True)
    if not row: return jsonify({'error': 'Not found'}), 404
    filepath = row['filepath']
    if not os.path.exists(filepath): return jsonify({'error': 'File missing'}), 404
    return send_file(filepath, mimetype='image/png')


# ═══════════════════════════════════════════════════════════════════════════════
#  GRID CALENDAR TEMPLATES
# ═══════════════════════════════════════════════════════════════════════════════
GRID_TEMPLATES = [
    {
        'id': 'morning_evening',
        'name': 'Morning / Evening Split',
        'icon': '🌅',
        'description': 'Post twice daily — morning = Follower Push, evening = Value Info.',
        'slots': ['Follower Push', 'Value Info Push'],
        'colors': ['#8b5cf6', '#10b981'],
        'pattern': 'am_pm',
    },
    {
        'id': 'sales_value_mix',
        'name': 'Sales + Value 3×/Week',
        'icon': '💰',
        'description': 'Mon/Wed/Fri = Sales Push, Tue/Thu = Value, Sat/Sun = Follower.',
        'slots': ['Sales Push', 'Value Info Push', 'Follower Push'],
        'colors': ['#ef4444', '#10b981', '#8b5cf6'],
        'pattern': 'weekday_map',
        'weekday_map': {0:'Sales Push',1:'Value Info Push',2:'Sales Push',
                        3:'Value Info Push',4:'Sales Push',5:'Follower Push',6:'Follower Push'}
    },
    {
        'id': 'tofu_mofu_bofu',
        'name': 'Funnel (TOFU→MOFU→BOFU)',
        'icon': '🎯',
        'description': 'Wk 1-2 awareness, Wk 3 consideration, Wk 4 conversion.',
        'slots': ['Awareness Post', 'Consideration Post', 'Conversion Post'],
        'colors': ['#3b82f6', '#f59e0b', '#ef4444'],
        'pattern': 'funnel_weeks',
    },
    {
        'id': 'five_day_cycle',
        'name': 'Daily Hero (5-Day Cycle)',
        'icon': '⚡',
        'description': 'Educate → Entertain → Inspire → Sell → Engage (repeating).',
        'slots': ['Educational Post','Entertainment Post','Inspirational Post','Sales Post','Engagement Post'],
        'colors': ['#10b981','#6366f1','#f59e0b','#ef4444','#ec4899'],
        'pattern': 'five_cycle',
    },
    {
        'id': 'follower_heavy',
        'name': 'Follower Growth Heavy',
        'icon': '📈',
        'description': '60 % Follower Push, 30 % Value, 10 % Sales — for rapid audience building.',
        'slots': ['Follower Push', 'Value Info Push', 'Sales Push'],
        'colors': ['#8b5cf6', '#10b981', '#ef4444'],
        'pattern': 'ratio',
        'ratio': [6, 3, 1],
    }
]

@app.route('/api/grids/templates')
def get_grid_templates():
    return jsonify(GRID_TEMPLATES)

@app.route('/api/grids/preview', methods=['POST'])
def grid_preview():
    data       = request.json or {}
    grid_id    = data.get('grid_id')
    days       = int(data.get('days', 30))
    start_date = data.get('start_date', datetime.now().strftime('%Y-%m-%d'))
    tmpl = next((g for g in GRID_TEMPLATES if g['id'] == grid_id), None)
    if not tmpl:
        return jsonify({'error': 'Grid not found'}), 404
    start_dt  = datetime.strptime(start_date, '%Y-%m-%d')
    pattern   = tmpl['pattern']
    slots_out = []
    type_colors = dict(zip(tmpl['slots'], tmpl['colors']))

    for d in range(days):
        dt      = start_dt + timedelta(days=d)
        weekday = dt.weekday()
        week_i  = d // 7
        if pattern == 'am_pm':
            am = tmpl['slots'][0]; pm = tmpl['slots'][1]
            slots_out.append({'day': d+1, 'date': dt.strftime('%Y-%m-%d'),
                              'weekday': dt.strftime('%a'), 'type': am,
                              'am': am, 'pm': pm,
                              'color': type_colors.get(am,'#6366f1')})
        elif pattern == 'weekday_map':
            t = tmpl['weekday_map'].get(weekday, tmpl['slots'][0])
            slots_out.append({'day': d+1, 'date': dt.strftime('%Y-%m-%d'),
                              'weekday': dt.strftime('%a'), 'type': t,
                              'am': None, 'pm': None, 'color': type_colors.get(t,'#6366f1')})
        elif pattern == 'funnel_weeks':
            if week_i <= 1: t = tmpl['slots'][0]
            elif week_i == 2: t = tmpl['slots'][1]
            else:            t = tmpl['slots'][2]
            slots_out.append({'day': d+1, 'date': dt.strftime('%Y-%m-%d'),
                              'weekday': dt.strftime('%a'), 'type': t,
                              'am': None, 'pm': None, 'color': type_colors.get(t,'#6366f1')})
        elif pattern == 'five_cycle':
            t = tmpl['slots'][d % 5]
            slots_out.append({'day': d+1, 'date': dt.strftime('%Y-%m-%d'),
                              'weekday': dt.strftime('%a'), 'type': t,
                              'am': None, 'pm': None, 'color': type_colors.get(t,'#6366f1')})
        elif pattern == 'ratio':
            ratio = tmpl['ratio']
            total = sum(ratio)
            pos   = d % total
            cum   = 0; t = tmpl['slots'][0]
            for i, r in enumerate(ratio):
                cum += r
                if pos < cum:
                    t = tmpl['slots'][i] if i < len(tmpl['slots']) else tmpl['slots'][0]
                    break
            slots_out.append({'day': d+1, 'date': dt.strftime('%Y-%m-%d'),
                              'weekday': dt.strftime('%a'), 'type': t,
                              'am': None, 'pm': None, 'color': type_colors.get(t,'#6366f1')})
    return jsonify({'grid': tmpl, 'slots': slots_out, 'days': days, 'type_colors': type_colors})


# ═══════════════════════════════════════════════════════════════════════════════
#  WHATSAPP
# ═══════════════════════════════════════════════════════════════════════════════
@app.route('/api/whatsapp/format', methods=['POST'])
def whatsapp_format():
    data       = request.json or {}
    concept_id = data.get('concept_id')
    if concept_id:
        c = query_db('SELECT * FROM concepts WHERE id=?', (concept_id,), one=True)
        if c:
            c = dict(c)
            caps = query_db('SELECT text FROM captions WHERE concept_id=? ORDER BY variation_number LIMIT 1', (concept_id,))
            cap  = caps[0]['text'] if caps else ''
            tags = query_db('SELECT tag FROM hashtags WHERE concept_id=? LIMIT 10', (concept_id,))
            tag_str = ' '.join([h['tag'] for h in tags])
            msg = (
                "\U0001F4F1 *ContentFlow Brief*\n"
                f"Day {c.get('day','?')} | {c.get('content_type','')} | {c.get('format','')}\n\n"
                f"*\U0001FA9D Hook:*\n{c.get('hook','')}\n\n"
                f"*\U0001F624 Problem:*\n{c.get('problem','') or '—'}\n\n"
                f"*\U0001F4A1 Solution:*\n{c.get('solution','') or '—'}\n\n"
                f"*\U0001F4E3 CTA:*\n{c.get('cta','') or '—'}\n\n"
                f"*\U0001F4DD Caption:*\n{cap}\n\n"
                f"{tag_str}\n\n"
                "_Sent from ContentFlow_"
            )
            encoded = urllib.parse.quote(msg)
            subject = urllib.parse.quote(f"ContentFlow Brief – Day {c.get('day','?')}")
            body_enc = urllib.parse.quote(msg)
            mailto = f"mailto:?subject={subject}&body={body_enc}"
            return jsonify({'message': msg, 'url': f'https://wa.me/?text={encoded}', 'mailto': mailto})
    raw_msg = data.get('message', '')
    return jsonify({'message': raw_msg,
                    'url': f'https://wa.me/?text={urllib.parse.quote(raw_msg)}',
                    'mailto': f"mailto:?body={urllib.parse.quote(raw_msg)}"})


# ═══════════════════════════════════════════════════════════════════════════════
#  ADMIN
# ═══════════════════════════════════════════════════════════════════════════════
@app.route('/admin')
def admin_page():
    return render_template('admin.html')

@app.route('/api/admin/stats')
def admin_stats():
    users      = query_db('SELECT COUNT(*) as n FROM users')[0]['n']
    projects   = query_db('SELECT COUNT(*) as n FROM clients')[0]['n']
    calendars  = query_db('SELECT COUNT(*) as n FROM calendars')[0]['n']
    concepts   = query_db('SELECT COUNT(*) as n FROM concepts')[0]['n']
    timers     = query_db('SELECT COUNT(*) as n FROM task_timers')[0]['n']
    total_sec  = query_db('SELECT SUM(duration_seconds) as s FROM task_timers')[0]['s'] or 0
    shots      = query_db('SELECT COUNT(*) as n FROM timer_screenshots')[0]['n']
    return jsonify({'users': users, 'projects': projects, 'calendars': calendars,
                    'concepts': concepts, 'timers': timers,
                    'total_hours': round(total_sec/3600, 1), 'screenshots': shots})

@app.route('/api/admin/users', methods=['GET'])
def admin_list_users():
    rows = query_db('SELECT * FROM users ORDER BY created_at DESC')
    return jsonify([dict(r) for r in rows])

@app.route('/api/admin/users/<uid>', methods=['PUT','DELETE'])
def admin_update_user(uid):
    if request.method == 'DELETE':
        execute_db('DELETE FROM users WHERE id=?', (uid,))
        return jsonify({'status': 'deleted'})
    data = request.json or {}
    if 'role' in data:
        execute_db('UPDATE users SET role=? WHERE id=?', (data['role'], uid))
    return jsonify({'status': 'updated'})

@app.route('/api/admin/timers', methods=['GET'])
def admin_timers():
    date_filter = request.args.get('date', '')
    if date_filter:
        rows = query_db('''SELECT t.*, c.hook, cl.name as project_name
                           FROM task_timers t
                           LEFT JOIN concepts c ON t.concept_id=c.id
                           LEFT JOIN clients cl ON t.client_id=cl.id
                           WHERE date(t.started_at)=?
                           ORDER BY t.started_at DESC LIMIT 200''', (date_filter,))
    else:
        rows = query_db('''SELECT t.*, c.hook, cl.name as project_name
                           FROM task_timers t
                           LEFT JOIN concepts c ON t.concept_id=c.id
                           LEFT JOIN clients cl ON t.client_id=cl.id
                           ORDER BY t.started_at DESC LIMIT 200''')
    result = []
    for r in (rows or []):
        t = dict(r)
        t['screenshots'] = [dict(s) for s in query_db(
            'SELECT id,filename,captured_at FROM timer_screenshots WHERE timer_id=? ORDER BY captured_at', (t['id'],))]
        result.append(t)
    return jsonify(result)

@app.route('/api/admin/projects', methods=['GET'])
def admin_projects():
    rows = query_db('''
        SELECT c.*,
               (SELECT COUNT(*) FROM calendars WHERE client_id=c.id) as calendar_count,
               (SELECT COUNT(*) FROM concepts cn JOIN calendars ca ON cn.calendar_id=ca.id WHERE ca.client_id=c.id) as concept_count
        FROM clients c ORDER BY c.created_at DESC
    ''')
    return jsonify([dict(r) for r in (rows or [])])

@app.route('/api/admin/settings', methods=['GET','POST'])
def admin_settings_api():
    ADMIN_KEYS = ['google_client_id','google_client_secret','twilio_account_sid',
                  'twilio_auth_token','twilio_whatsapp_number','app_name','allow_guest_login',
                  'asana_api_key','asana_workspace_id']
    if request.method == 'GET':
        result = {}
        for k in ADMIN_KEYS:
            v = get_setting(k) or ''
            if k in ('google_client_secret','twilio_auth_token','asana_api_key') and len(v) > 8:
                result[k] = '*'*8 + v[-4:]
            else:
                result[k] = v
        return jsonify(result)
    data = request.json or {}
    for k in ADMIN_KEYS:
        if k in data and not (isinstance(data[k],str) and data[k].startswith('*')):
            set_setting(k, data[k])
    return jsonify({'status': 'saved'})

@app.route('/api/admin/activity', methods=['GET'])
def admin_activity():
    rows = query_db('SELECT * FROM activity_feed ORDER BY created_at DESC LIMIT 100')
    return jsonify([dict(r) for r in rows])


@app.route('/api/calendars/<cal_id>/campaign-grids', methods=['GET', 'PUT'])
def campaign_grid_configs_route(cal_id):
    DEFAULT_GRIDS = [
        {'grid_index': 0, 'name': 'Value Content',  'color': '#6366f1', 'icon': '💎',
         'content_types': ['Value Bomb', 'Carousel Tutorial', 'Tutorial Reel']},
        {'grid_index': 1, 'name': 'Growth Content', 'color': '#10b981', 'icon': '📚',
         'content_types': ['Tutorial', 'Industry Hack', 'Myth-Bust', 'Behind the Scenes', 'How-It-Works']},
        {'grid_index': 2, 'name': 'Sales Content',  'color': '#f59e0b', 'icon': '🔥',
         'content_types': ['Godfather Offer', 'Flash Sale', 'Bundle Deal']},
    ]
    if request.method == 'GET':
        rows = query_db('SELECT * FROM campaign_grid_configs WHERE calendar_id=? ORDER BY grid_index', (cal_id,))
        if rows:
            result = []
            for r in rows:
                d = dict(r)
                try: d['content_types'] = json.loads(d['content_types'])
                except: d['content_types'] = []
                result.append(d)
            return jsonify(result)
        return jsonify(DEFAULT_GRIDS)
    grids = request.json or []
    for g in grids[:3]:
        gid = g.get('id') or str(uuid.uuid4())
        execute_db('''INSERT OR REPLACE INTO campaign_grid_configs
            (id,calendar_id,grid_index,name,color,icon,content_types)
            VALUES (?,?,?,?,?,?,?)''',
            (gid, cal_id, int(g['grid_index']), g.get('name',''), g.get('color','#6366f1'),
             g.get('icon','📝'), json.dumps(g.get('content_types',[]))))
    return jsonify({'status': 'saved'})


@app.route('/api/calendars/<cal_id>/generate-day', methods=['POST'])
def generate_campaign_day(cal_id):
    data          = request.json or {}
    day           = int(data.get('day', 1))
    gi            = int(data.get('grid_index', 0))
    timing        = data.get('timing', 'AM')
    confirmed_offer = (data.get('confirmed_offer') or data.get('offer_instruction') or '').strip()
    formats       = data.get('formats') or ['carousel']

    cal = query_db('SELECT * FROM calendars WHERE id=?', (cal_id,), one=True)
    if not cal: return jsonify({'error': 'Calendar not found'}), 404
    cal = dict(cal)
    project = query_db('SELECT * FROM clients WHERE id=?', (cal['client_id'],), one=True)
    if not project: return jsonify({'error': 'Project not found'}), 404
    p = dict(project)

    # Grid config
    grid_row = query_db('SELECT * FROM campaign_grid_configs WHERE calendar_id=? AND grid_index=?', (cal_id, gi), one=True)
    defaults = [
        ('Value Content',  '#6366f1', ['Value Bomb', 'Carousel Tutorial', 'Tutorial Reel']),
        ('Growth Content', '#10b981', ['Tutorial', 'Industry Hack', 'Myth-Bust', 'Behind the Scenes', 'How-It-Works']),
        ('Sales Content',  '#f59e0b', ['Godfather Offer', 'Flash Sale', 'Bundle Deal']),
    ]
    grid_name = grid_row['name'] if grid_row else defaults[gi][0]
    grid_types_raw = grid_row['content_types'] if grid_row else '[]'
    try:    grid_types = json.loads(grid_types_raw)
    except: grid_types = []
    if not grid_types: grid_types = defaults[gi][2]

    try:    start_dt = datetime.strptime(cal['month'] + '-01', '%Y-%m-%d')
    except: start_dt = datetime.now()
    concept_date = (start_dt + timedelta(days=day - 1)).strftime('%Y-%m-%d')

    # Fetch existing hooks for this grid column so the AI avoids repeating them
    existing_hooks_rows = query_db(
        'SELECT hook FROM concepts WHERE calendar_id=? AND grid_slot_type=? AND hook IS NOT NULL AND hook != "" ORDER BY day',
        (cal_id, grid_name))
    existing_hooks = [r['hook'] for r in (existing_hooks_rows or [])]
    if existing_hooks:
        hooks_str = '\n'.join(f'  - {h}' for h in existing_hooks[-8:])  # last 8 max
        avoid_line = (
            f'\nAVOID DUPLICATION — Do NOT reuse, echo, or start with the same words as these existing hooks:\n'
            f'{hooks_str}\n'
            f'Write a COMPLETELY DIFFERENT angle, opener, and structure.')
    else:
        avoid_line = ''

    offer_line = f'Irresistible offer: {confirmed_offer}' if confirmed_offer else ''
    biz_ctx = f"""Business: {p['name']} — {p.get('niche','')} ({p.get('business_type','')})
USP: {p.get('unique_selling_point','')}
Target: age {p.get('target_age','25-35')}, interests: {p.get('target_interests','')}
Pain points: {p.get('target_pain_points','')}
Tone: {p.get('tone_of_voice','Fun & Relatable')}
Grid: {grid_name} | Day {day} | Slot: {timing}
Content type: {', '.join(grid_types[:3])}
{offer_line}{avoid_line}
LANGUAGE RULE: Use plain everyday words. No industry jargon or fancy culinary terms (no sommelier, amuse-bouche, degustation, cuvée, mise en place, etc). Write like a friendly local talking to real customers on Instagram."""

    # CTA strategy differs per grid column
    is_value = 'value' in grid_name.lower()
    is_growth = 'growth' in grid_name.lower()
    if is_value:
        cta_instruction = 'CTA must invite people to FOLLOW for more tips, or DM a keyword to get a free resource (e.g. "DM us MENU and we\'ll send the full guide").'
    elif is_growth:
        # Growth = educational content — CTA drives saves, follows for the series, or DM for more detail
        cta_instruction = ('CTA must be education-driven: ask people to SAVE this post, FOLLOW for Part 2, '
                           'or DM a word to get the full tutorial/checklist. No selling, no discount codes. '
                           'Example: "Save this post so you don\'t forget it" or "Follow us — we\'re sharing Part 2 tomorrow".')
    else:
        cta_instruction = 'CTA must drive a direct action: Book a table, Call now, DM to reserve — with urgency.'

    # Meta ads / boosted reels safety note injected into every prompt
    brand_name = p.get('name', 'the brand')
    meta_safe = f"""META ADS SAFE ZONE — CRITICAL:
- NEVER place important text or CTA in the bottom 25% of the image — Meta ads, Boost button, and reel controls cover it.
- All headlines and key text: TOP 1/3 or CENTER of the image.
- Bottom area: food/people photo only, no text.
- BRAND WATERMARK: "{brand_name}" logo or name MUST always appear in ONE corner (top-left or top-right preferred). Small, clean — always visible on every slide/frame/image. Never skip this.
- Layout order (top to bottom): Brand corner badge → Headline → Offer → Visual (food/people) → nothing important at very bottom."""

    FORMAT_PROMPTS = {
        'carousel': f"""{biz_ctx}

Create a PUNCHY Instagram CAROUSEL. Style: bold food/restaurant ad — BIG short headlines, minimal text, strong visuals.
RULES:
- Hook slide headline: max 5 words, bold (e.g. "3 Dishes That Sell Out Daily")
- Each content slide: ONE short headline (max 6 words) + max 1 bullet (max 8 words)
- No paragraphs. Think billboard, not essay.
- {cta_instruction}
- BRAND RULE: "{brand_name}" name/logo must appear in the same corner on EVERY slide (top-left or top-right). Small badge, always present.
- design_tip: Include EXACT Canva layout — text position (top/center), font, color, AND brand badge corner. E.g. "Headline top-center in white Impact font on dark overlay. Food photo fills bottom 60%. '{brand_name}' badge top-right corner on every slide. No text below centre line."
- {meta_safe}

Return ONLY this JSON (5 slides total):
{{"hook":"","content_type":"{grid_types[0]}","num_slides":5,"hook_slide":{{"headline":"","subtext":""}},"slides":[{{"slide_num":2,"headline":"","bullets":[""]}}],"cta_slide":{{"headline":"","action":""}},"design_tip":""}}""",

        'single_post': f"""{biz_ctx}

Create a PUNCHY SINGLE IMAGE post for Instagram/Meta ads. One bold message, minimal text.
RULES:
- overlay_text: max 6 words — the ONE stop-scroll line (e.g. "Bring a Friend · 10% Off")
- TEXT PLACEMENT: overlay text must be TOP or CENTER of image — never bottom
- visual_direction: food/people photo fills BOTTOM 60-70% of frame; text/brand sits on TOP portion on dark or gradient overlay
- caption_hook: first caption line only — max 12 words
- BRAND RULE: "{brand_name}" name/logo always visible in top-left or top-right corner — small, clean badge.
- {cta_instruction}
- canva_tip: Describe EXACT safe-zone layout including brand corner. E.g. "Top half: dark gradient overlay with headline in white bold 60px. '{brand_name}' logo top-right corner. Bottom half: hero food photo. Nothing important in bottom 25%."
- {meta_safe}

Return ONLY this JSON:
{{"hook":"","content_type":"{grid_types[0]}","visual_direction":"","overlay_text":"","caption_hook":"","mood":"","cta":"","canva_tip":""}}""",

        'video_heygen': f"""{biz_ctx}

Create a SHORT VIDEO SCRIPT for HeyGen AI avatar. Max 20 seconds — punchy, hook in first 3 seconds.
RULES:
- Each scene script: max 2 sentences, conversational, direct
- Avatar should stand in TOP or CENTER frame — NOT at bottom (lower third text covers bottom)
- BRAND RULE: "{brand_name}" name/logo visible as a persistent corner watermark throughout the video (top-left or top-right).
- {cta_instruction}
- lower_third: short text shown at bottom bar (max 5 words — this IS safe at very bottom as it's a bar)
- background_suggestion: clean, uncluttered — restaurant interior or plain brand colour

Return ONLY this JSON (3 scenes, 6s each):
{{"hook":"","content_type":"{grid_types[0]}","duration_seconds":18,"scenes":[{{"scene":1,"duration_s":6,"script":"","lower_third":""}}],"avatar_suggestion":"","background_suggestion":"","brand_watermark":"top-right corner, small logo throughout","cta_text":""}}""",

        'video_canva': f"""{biz_ctx}

Create a SHORT CANVA VIDEO REEL storyboard. Max 15 seconds, 3 frames, fast cuts, text-forward.
RULES:
- Each frame text_overlay: max 5 words — big, bold, one message per frame
- Frame 1: hook (bold claim or question), Frame 2: proof/offer, Frame 3: CTA
- TEXT PLACEMENT: All text overlays must appear in the TOP or CENTER of the frame — NEVER at the bottom
- BRAND RULE: "{brand_name}" name/logo as a small persistent watermark in the top-left or top-right corner on ALL frames.
- visual: food/people in background; text sits in top 60% of frame
- {cta_instruction}
- {meta_safe}

Return ONLY this JSON:
{{"hook":"","content_type":"{grid_types[0]}","duration_seconds":15,"music_mood":"","frames":[{{"second":"0-5","text_overlay":"","visual":"","transition":"Cut"}}],"color_scheme":"","font_style":"","brand_watermark":"top-right corner, small logo on every frame"}}"""
    }

    try:
        claude_client = get_claude_client()
    except ValueError as ex:
        return jsonify({'error': str(ex)}), 400

    formats_content = {}
    base_concept    = {}

    for fmt in formats:
        if fmt not in FORMAT_PROMPTS:
            continue
        try:
            msg = claude_client.messages.create(
                model='claude-haiku-4-5-20251001', max_tokens=900,
                messages=[{'role': 'user', 'content': FORMAT_PROMPTS[fmt]}])
            txt = msg.content[0].text.strip()
            s, e = txt.find('{'), txt.rfind('}') + 1
            parsed = json.loads(txt[s:e]) if s >= 0 else {}
            formats_content[fmt] = parsed
            if not base_concept:
                base_concept = parsed
        except Exception:
            formats_content[fmt] = {'error': 'Generation failed for this format'}

    # Derive hook + content_type for DB storage
    hook         = base_concept.get('hook', '')
    content_type = base_concept.get('content_type', grid_types[0] if grid_types else 'Value Bomb')

    # Check by grid_slot_type (primary) OR by grid_index (fallback for legacy rows)
    existing = query_db(
        'SELECT id FROM concepts WHERE calendar_id=? AND day=? AND (grid_slot_type=? OR grid_slot_type IS NULL OR grid_slot_type="")',
        (cal_id, day, grid_name), one=True)
    # Prefer exact name match; if above returned a mismatched row, re-check precisely
    if existing:
        exact = query_db(
            'SELECT id FROM concepts WHERE calendar_id=? AND day=? AND grid_slot_type=?',
            (cal_id, day, grid_name), one=True)
        if exact:
            existing = exact
        # else keep the fuzzy match (old row without grid_slot_type)
    if existing:
        cid = existing['id']
        execute_db(
            '''UPDATE concepts SET content_type=?,format=?,hook=?,idea_brief=?,grid_slot_type=? WHERE id=?''',
            (content_type, ','.join(formats), hook,
             confirmed_offer or hook, grid_name, cid))
    else:
        cid = str(uuid.uuid4())
        execute_db(
            '''INSERT INTO concepts
               (id,calendar_id,day,date,content_type,format,hook,problem,solution,cta,
                platform,predicted_engagement,idea_brief,grid_slot_type)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
            (cid, cal_id, day, concept_date,
             content_type, ','.join(formats), hook,
             '', '', '',
             'Instagram', 4.0,
             confirmed_offer or hook, grid_name))

    # Save offer to history to avoid repeats
    if confirmed_offer:
        execute_db(
            'INSERT INTO offer_history (id,calendar_id,day,grid_index,offer_text) VALUES (?,?,?,?,?)',
            (str(uuid.uuid4()), cal_id, day, gi, confirmed_offer))

    # Background captions
    tone  = p.get('tone_of_voice', 'Fun & Relatable')
    niche = p.get('niche', '')
    def _bg(cid2, hook2, niche2, tone2, ct2):
        try:
            cap = generate_captions_with_claude(hook2, '', '', '', niche2, tone2, ct2)
            for cp in cap.get('captions', []):
                execute_db('INSERT INTO captions (id,concept_id,variation_number,text) VALUES (?,?,?,?)',
                           (str(uuid.uuid4()), cid2, cp['number'], cp['text']))
            for i, tag in enumerate(cap.get('hashtags', [])[:15]):
                vol = 'high' if i < 5 else 'mid' if i < 10 else 'niche'
                execute_db('INSERT INTO hashtags (id,concept_id,tag,volume_level) VALUES (?,?,?,?)',
                           (str(uuid.uuid4()), cid2, tag, vol))
        except Exception:
            pass
    threading.Thread(target=_bg, args=(cid, hook, niche, tone, content_type), daemon=True).start()

    return jsonify({
        'concept': {'id': cid, 'hook': hook, 'content_type': content_type,
                    'format': ','.join(formats), 'day': day, 'grid_index': gi,
                    'timing': timing, 'date': concept_date},
        'formats_content': formats_content,
        'status': 'generated'
    })


@app.route('/api/calendars/<cal_id>/offer-pool', methods=['GET', 'POST', 'DELETE'])
def campaign_offer_pool_route(cal_id):
    """
    GET  ?grid_index=N        → return saved pool for that grid column only
    POST {grid_index, offers, replace?} → save offers for that grid column
    DELETE ?offer_id=X        → remove one offer by id
    """
    GRID_NAMES = ['Value Content', 'Growth Content', 'Sales Content']

    if request.method == 'GET':
        gi = int(request.args.get('grid_index', 0))
        rows = query_db(
            'SELECT * FROM campaign_offer_pool WHERE calendar_id=? AND grid_index=? ORDER BY sort_order,created_at',
            (cal_id, gi))
        return jsonify({'offers': [dict(r) for r in (rows or [])], 'grid_index': gi})

    elif request.method == 'POST':
        data    = request.json or {}
        gi      = int(data.get('grid_index', 0))
        gname   = GRID_NAMES[gi] if gi < len(GRID_NAMES) else f'Grid {gi}'
        offers  = data.get('offers', [])
        # Replace only this grid's pool if replace=True
        if data.get('replace'):
            execute_db('DELETE FROM campaign_offer_pool WHERE calendar_id=? AND grid_index=?', (cal_id, gi))
        for i, o in enumerate(offers):
            execute_db(
                '''INSERT INTO campaign_offer_pool
                   (id,calendar_id,grid_index,grid_name,offer_text,hook_line,urgency,sort_order)
                   VALUES (?,?,?,?,?,?,?,?)''',
                (str(uuid.uuid4()), cal_id, gi, gname,
                 o.get('offer', o.get('offer_text', '')),
                 o.get('hook_line', ''), o.get('urgency', ''), i))
        rows = query_db(
            'SELECT * FROM campaign_offer_pool WHERE calendar_id=? AND grid_index=? ORDER BY sort_order,created_at',
            (cal_id, gi))
        return jsonify({'offers': [dict(r) for r in (rows or [])], 'grid_index': gi})

    elif request.method == 'DELETE':
        offer_id = request.args.get('offer_id') or (request.json or {}).get('offer_id')
        if offer_id:
            execute_db('DELETE FROM campaign_offer_pool WHERE id=? AND calendar_id=?', (offer_id, cal_id))
        return jsonify({'ok': True})


@app.route('/api/calendars/<cal_id>/offer-suggest', methods=['GET'])
def cg_offer_suggest(cal_id):
    day = int(request.args.get('day', 1))
    gi  = int(request.args.get('grid_index', 0))
    # count=7 for pool-building mode, count=1 for single-rotation mode
    count = int(request.args.get('count', 7))

    cal = query_db('SELECT * FROM calendars WHERE id=?', (cal_id,), one=True)
    if not cal: return jsonify({'error':'Not found'}), 404
    cal = dict(cal)
    project = query_db('SELECT * FROM clients WHERE id=?', (cal['client_id'],), one=True)
    if not project: return jsonify({'error':'Not found'}), 404
    p = dict(project)

    # Load THIS grid's pool to avoid repeating
    pool_rows = query_db(
        'SELECT offer_text FROM campaign_offer_pool WHERE calendar_id=? AND grid_index=?',
        (cal_id, gi))
    pool_texts = [r['offer_text'] for r in (pool_rows or []) if r['offer_text']]
    prev_offers = query_db(
        'SELECT offer_text FROM offer_history WHERE calendar_id=? AND grid_index=? ORDER BY created_at DESC LIMIT 10',
        (cal_id, gi))
    prev_list = [r['offer_text'] for r in (prev_offers or []) if r['offer_text']]

    total   = cal.get('campaign_days') or 30
    phase   = 'early (build trust)' if day <= total*.33 else ('mid (build momentum)' if day <= total*.66 else 'late (urgency + close)')

    avoid_texts = list({*pool_texts, *prev_list})[:10]
    avoid_block = ''
    if avoid_texts:
        avoid_block = '\n\nAVOID offers similar to these already-saved ones:\n' + '\n'.join(f'• {o[:80]}' for o in avoid_texts)

    biz_block = f"""BUSINESS:
Business: {p['name']} ({p.get('niche','')}, {p.get('business_type','')})
USP: {p.get('unique_selling_point','')}
Audience: age {p.get('target_age','')}, {p.get('target_interests','')}
Pain points: {p.get('target_pain_points','')}
Campaign phase: day {day}/{total} — {phase}{avoid_block}"""

    # ── Grid-specific offer prompts ───────────────────────────────────────
    if gi == 0:
        # VALUE CONTENT: educate, build authority, free resources — NO discounts/sales
        prompt = f"""You are a content strategist. Generate {count} VALUE BOMB ideas for Instagram.

PURPOSE: Build authority and trust. Give something genuinely useful for FREE.
These go into the VALUE CONTENT column — education only, no selling, no discounts.

VALUE BOMB MECHANICS (use different ones across the {count} ideas):
- DM keyword: "DM us the word TIPS and we'll send you our full guide"
- Free resource: "Follow + save this post to get our printable checklist"
- Secret tip: "Most people don't know this about [topic] — we're giving it away"
- Myth-bust: "Stop doing X. Here's what actually works"
- How-to reveal: "We'll show you exactly how we do [result] step by step"
- Behind-the-scenes: "This is what nobody talks about in [industry]"
- Free mini-course: "3-part series starting tomorrow — follow so you don't miss it"
- Resource drop: "We just uploaded our [template/checklist/guide] — DM us FREE"

RULES:
- Zero selling, zero discounts, zero urgency pressure
- Give genuine value the audience actually wants
- Hook is curiosity or education-driven
- Each idea uses a DIFFERENT mechanic from the list above
- 2-3 lines max, plain words

{biz_block}

Return ONLY this JSON array of exactly {count} items:
[{{"offer":"<the value bomb idea>","hook_line":"<curiosity hook for the post>","urgency":""}}]"""

    elif gi == 1:
        # GROWTH CONTENT: genuine problem-solving information — real facts, real steps, real answers
        # Earns saves and shares because it actually teaches something useful — zero gimmicks
        prompt = f"""You are an expert content strategist. Generate {count} PROBLEM-SOLVING CONTENT IDEAS for the Growth Content column.

PURPOSE: Give the audience REAL, SPECIFIC information that solves an actual problem they face related to this business's niche.
This content earns saves and shares because it is genuinely useful — not because of a giveaway or tag mechanic.

CONTENT STRUCTURE (each idea must follow this pattern):
1. Name the SPECIFIC problem the audience has (real, recognisable pain)
2. Give the REAL ANSWER — actual steps, real data, clear process, expert insight
3. The audience should be able to act on this information TODAY without needing to buy anything

CONTENT ANGLES (use different ones across the {count} ideas):
- Root-cause diagnosis: "Why [common problem] keeps happening — the actual reason (not the obvious one)"
- Actionable how-to: "Exactly how to [achieve result] — step 1, step 2, step 3 with specifics"
- Industry truth reveal: "What [professionals/experts] actually do vs. what they tell the public"
- Common mistake fix: "Most people do [X wrong thing]. Here is what works, and why it works"
- Comparison with real criteria: "How to tell the difference between [good vs. bad version of thing] — 3 exact signs"
- Hidden process: "Here is exactly what happens when [process] — most people never see this"
- Data-backed insight: "The numbers on [topic] that change how you should approach [decision]"
- Checklist/framework: "[N]-point checklist to [achieve outcome] — use this every time"
- Warning with fix: "If you notice [specific sign], here is what it means and what to do immediately"
- Insider shortcut: "The shortcut [experienced people] use — skips [common painful step] entirely"

RULES:
- Each idea must be SPECIFIC to the business niche — not generic advice
- Must include real information, not vague platitudes ("eat healthy" is bad; "reduce [ingredient] by X% to prevent [outcome]" is good)
- Zero selling, zero discounts, zero promotional language — pure useful information
- Each idea must address a DIFFERENT problem or topic
- 2-3 lines explaining the content angle in plain words

{biz_block}

Return ONLY this JSON array of exactly {count} items:
[{{"offer":"<the specific educational content topic and angle>","hook_line":"<hook that names the exact problem the audience recognises>","urgency":""}}]"""

    else:
        # SALES CONTENT: promote the business's actual services/products directly — drive bookings and purchases
        prompt = f"""You are a direct-response copywriter for local businesses. Generate {count} SERVICE PROMOTION IDEAS for the Sales Content column on Instagram.

PURPOSE: Showcase this business's SPECIFIC SERVICES OR PRODUCTS and make the audience want to buy, book, or visit RIGHT NOW.
These are NOT generic deals or value bombs — they spotlight what this business actually sells and why the audience should choose it.

PROMOTION ANGLES (use different ones across the {count} ideas):
- Service spotlight: Highlight ONE specific service/product, explain exactly what it includes and who it is for
- Social proof close: "[Number] customers this month chose [service] because [specific reason] — here's what they got"
- Before/after outcome: "Before: [problem customer had]. After: [result they got from this service]. This is what we do."
- Expertise proof: "We have [credential/experience/years] doing [service]. Here is what makes our approach different."
- Objection crusher: "Most people think [service] is [wrong assumption]. Here is the truth — and what you actually get."
- Specific result: "[Service name] from us means [specific measurable outcome]. Book this week and see it yourself."
- Comparison win: "Other [businesses] offer [generic version]. We offer [specific better version]. Here is the difference."
- Availability push: "We have [X slots/openings] this week for [service]. Once they are gone they are gone."
- Testimonial angle: "A customer came to us with [problem]. They chose [service]. This is exactly what happened."
- Direct invite: "If you have been dealing with [specific pain point], [service name] is built exactly for that. Here is how to get it."

RULES:
- Every idea must reference what THIS business actually sells — not generic offers
- Focus on the specific SERVICE or PRODUCT, its outcome, and why this business is the right choice
- CTA must be direct: Book, Call, DM 'BOOK', Visit us, Reserve your slot — clear next step
- Urgency is about availability or results, not artificial discounts
- Plain words, no jargon
- 2-3 lines max describing the promotion angle

{biz_block}

Return ONLY this JSON array of exactly {count} items:
[{{"offer":"<the service promotion idea>","hook_line":"<scroll-stopping first line that names the service or outcome>","urgency":"<availability or result-based urgency>"}}]"""

    try:
        client = get_claude_client()
        msg = client.messages.create(model='claude-haiku-4-5-20251001', max_tokens=1600,
                                     messages=[{'role':'user','content':prompt}])
        txt = msg.content[0].text.strip()
        s, e = txt.find('['), txt.rfind(']') + 1
        offers = json.loads(txt[s:e]) if s >= 0 else []
        return jsonify({'offers': offers, 'day': day, 'grid_index': gi, 'phase': phase})
    except Exception as ex: return jsonify({'error': str(ex)}), 500


@app.route('/api/calendars/<cal_id>/reset', methods=['DELETE'])
def reset_calendar(cal_id):
    """Delete all concepts for this calendar so the grid goes back to empty."""
    try:
        user = session.get('user')
        if not user:
            return jsonify({'error': 'Not logged in — please refresh and log in again'}), 401
        if user.get('role') not in ('admin', 'manager'):
            return jsonify({'error': 'Only admin or manager can reset campaigns'}), 403
        cal = query_db('SELECT * FROM calendars WHERE id=?', (cal_id,), one=True)
        if not cal:
            return jsonify({'error': 'Calendar not found'}), 404
        # Delete all child data for every concept in this calendar
        concept_ids = [r['id'] for r in query_db('SELECT id FROM concepts WHERE calendar_id=?', (cal_id,))]
        for cid in concept_ids:
            for tbl in ('captions', 'hashtags', 'comments', 'metrics', 'tasks'):
                try:
                    execute_db(f'DELETE FROM {tbl} WHERE concept_id=?', (cid,))
                except Exception:
                    pass  # table may not exist in all deployments
        execute_db('DELETE FROM concepts WHERE calendar_id=?', (cal_id,))
        # Clear offer pool
        try:
            execute_db('DELETE FROM campaign_offer_pool WHERE calendar_id=?', (cal_id,))
        except Exception:
            pass
        return jsonify({'status': 'reset', 'calendar_id': cal_id, 'deleted': len(concept_ids)})
    except Exception as ex:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Reset failed: {str(ex)}'}), 500


@app.route('/api/calendars/<cal_id>/regenerate-format', methods=['POST'])
def regenerate_cg_format(cal_id):
    data          = request.json or {}
    day           = int(data.get('day', 1))
    gi            = int(data.get('grid_index', 0))
    timing        = data.get('timing', 'AM')
    confirmed_offer = (data.get('confirmed_offer') or '').strip()
    fmt           = data.get('format', 'carousel')

    cal = query_db('SELECT * FROM calendars WHERE id=?', (cal_id,), one=True)
    if not cal: return jsonify({'error': 'Not found'}), 404
    cal = dict(cal)
    project = query_db('SELECT * FROM clients WHERE id=?', (cal['client_id'],), one=True)
    if not project: return jsonify({'error': 'Not found'}), 404
    p = dict(project)

    grid_row = query_db('SELECT * FROM campaign_grid_configs WHERE calendar_id=? AND grid_index=?', (cal_id, gi), one=True)
    defaults = [
        ('Value Content',  '#6366f1', ['Value Bomb','Carousel Tutorial','Tutorial Reel']),
        ('Growth Content', '#10b981', ['Problem-Solution','Industry Insight','Myth-Bust','How-It-Works','Step-by-Step Guide']),
        ('Sales Content',  '#f59e0b', ['Service Spotlight','Outcome Proof','Expertise Showcase','Direct Offer','Booking Push']),
    ]
    grid_name  = grid_row['name'] if grid_row else defaults[gi][0]
    grid_types_raw = grid_row['content_types'] if grid_row else '[]'
    try:    grid_types = json.loads(grid_types_raw)
    except: grid_types = []
    if not grid_types: grid_types = defaults[gi][2]

    offer_line = f'Irresistible offer: {confirmed_offer}' if confirmed_offer else ''
    biz_ctx = f"""Business: {p['name']} — {p.get('niche','')} ({p.get('business_type','')})
USP: {p.get('unique_selling_point','')}
Target: age {p.get('target_age','25-35')}, interests: {p.get('target_interests','')}
Pain points: {p.get('target_pain_points','')}
Tone: {p.get('tone_of_voice','Fun & Relatable')}
Grid: {grid_name} | Day {day} | Slot: {timing}
Content type: {', '.join(grid_types[:3])}
{offer_line}
IMPORTANT: Generate a FRESH variation — different angle, hook style, and structure from any previous version."""

    is_value  = 'value'  in grid_name.lower()
    is_growth = 'growth' in grid_name.lower()
    is_sales  = 'sales'  in grid_name.lower()
    if is_value:
        cta_r = 'CTA: tell people to FOLLOW for more free tips, or DM a keyword to receive a free guide/resource.'
        content_intent = 'PURPOSE: Educate and build trust. Give genuinely useful free information — no selling, no service promotion.'
    elif is_growth:
        cta_r = 'CTA: "Save this post" or "Share with someone who needs this" — earned through genuinely useful content, NOT a giveaway or tag mechanic.'
        content_intent = 'PURPOSE: Solve a REAL, SPECIFIC problem with actual information the audience can act on today. Teach something concrete — steps, data, process, insider knowledge. Zero selling.'
    else:
        cta_r = 'CTA: drive direct service action — "Book Now", "Call Us", "DM BOOK to reserve your slot", "Visit us this week" — clear and direct.'
        content_intent = 'PURPOSE: Promote this business\'s specific services or products. Show outcomes, proof, and expertise. Make the audience want to book or buy from THIS business specifically.'

    # Meta ads safe zone + brand watermark — injected into every regenerate prompt
    brand_name_r = p.get('name', 'the brand')
    meta_safe_r = f"META SAFE ZONE: ALL text/overlay in TOP or CENTER of image/frame. Bottom 25% = food/people photo only — Meta/Instagram UI hides it. Never put headline or CTA at bottom. BRAND: \"{brand_name_r}\" name/logo must appear in top-left or top-right corner on every image/frame/slide — always visible, never skip."

    FORMAT_PROMPTS = {
        'carousel':     f"""{biz_ctx}\n{content_intent}\nPUNCHY carousel. BIG short headlines (max 6 words each), max 1 bullet per slide (max 8 words). No paragraphs. design_tip must specify text at top or center of slide AND \"{brand_name_r}\" badge in top corner on every slide. {cta_r}\n{meta_safe_r}\nReturn ONLY: {{"hook":"","content_type":"{grid_types[0]}","num_slides":5,"hook_slide":{{"headline":"","subtext":""}},"slides":[{{"slide_num":2,"headline":"","bullets":[""]}}],"cta_slide":{{"headline":"","action":""}},"design_tip":""}}""",
        'single_post':  f"""{biz_ctx}\n{content_intent}\nPUNCHY single image. overlay_text max 6 words — placed at TOP of image. canva_tip must confirm text in top 60% AND \"{brand_name_r}\" small badge in top corner. caption_hook max 12 words. {cta_r}\n{meta_safe_r}\nReturn ONLY: {{"hook":"","content_type":"{grid_types[0]}","visual_direction":"","overlay_text":"","caption_hook":"","mood":"","cta":"","canva_tip":""}}""",
        'video_heygen': f"""{biz_ctx}\n{content_intent}\nSHORT video script. Max 20s, 3 scenes×6s. Max 2 sentences per scene. Avatar TOP or CENTER frame. \"{brand_name_r}\" logo as persistent corner watermark throughout. lower_third is safe bottom bar (5 words max). {cta_r}\n{meta_safe_r}\nReturn ONLY: {{"hook":"","content_type":"{grid_types[0]}","duration_seconds":18,"scenes":[{{"scene":1,"duration_s":6,"script":"","lower_third":""}}],"avatar_suggestion":"","background_suggestion":"","brand_watermark":"top-right corner throughout","cta_text":""}}""",
        'video_canva':  f"""{biz_ctx}\n{content_intent}\nSHORT Canva reel. Max 15s, 3 frames, text overlay max 5 words each — ALL overlays TOP or CENTER of frame. \"{brand_name_r}\" small logo in top corner on ALL frames. Frame 1=hook, Frame 2=content, Frame 3=CTA. {cta_r}\n{meta_safe_r}\nReturn ONLY: {{"hook":"","content_type":"{grid_types[0]}","duration_seconds":15,"music_mood":"","frames":[{{"second":"0-5","text_overlay":"","visual":"","transition":"Cut"}}],"color_scheme":"","font_style":"","brand_watermark":"top-right corner on every frame"}}""",
    }

    if fmt not in FORMAT_PROMPTS:
        return jsonify({'error': f'Unknown format: {fmt}'}), 400

    try:
        claude_client = get_claude_client()
        msg = claude_client.messages.create(
            model='claude-haiku-4-5-20251001', max_tokens=900,
            messages=[{'role': 'user', 'content': FORMAT_PROMPTS[fmt]}])
        txt = msg.content[0].text.strip()
        s, e = txt.find('{'), txt.rfind('}') + 1
        result = json.loads(txt[s:e]) if s >= 0 else {}
        return jsonify({'format': fmt, 'content': result})
    except ValueError as ex: return jsonify({'error': str(ex)}), 400
    except Exception as ex:  return jsonify({'error': str(ex)}), 500


@app.route('/magic-bay')
def magic_bay_sim():
    return render_template('magic_bay_sim.html')

@app.route('/magic-bay-dashboards')
def magic_bay_dashboards():
    return render_template('magic_bay_dashboards.html')

@app.route('/asean-mall')
def asean_mall_site():
    return render_template('asean_mall_site.html')

# Always initialise DB — needed for Vercel serverless (no __main__ block runs)
init_db()

if __name__ == '__main__':
    threading.Thread(target=daily_reminder_scheduler, daemon=True).start()
    print("\n🚀 ContentFlow running at http://localhost:8080\n")
    is_dev = os.environ.get('FLASK_ENV', 'development') != 'production'
    app.run(debug=is_dev, port=int(os.environ.get('PORT', 8080)))
