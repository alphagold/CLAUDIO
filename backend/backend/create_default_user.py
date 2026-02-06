#!/usr/bin/env python3
"""
Script per creare utente di default con password corretta
Eseguito automaticamente dall'API all'avvio
"""
import sys
from passlib.context import CryptContext
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import os

# Password context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Database URL
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://photomemory:photomemory123@postgres:5432/photomemory")

def create_default_user():
    """Crea o aggiorna utente di default"""
    try:
        # Connessione database
        engine = create_engine(DATABASE_URL)
        SessionLocal = sessionmaker(bind=engine)
        db = SessionLocal()

        # Genera hash corretto per "test123"
        password_hash = pwd_context.hash("test123")

        print("🔑 Generazione hash password per utente test...")

        # Inserisci o aggiorna utente
        query = text("""
            INSERT INTO users (email, password_hash, is_admin, preferred_model, auto_analyze)
            VALUES (:email, :password_hash, :is_admin, :preferred_model, :auto_analyze)
            ON CONFLICT (email)
            DO UPDATE SET password_hash = EXCLUDED.password_hash;
        """)

        db.execute(query, {
            "email": "test@example.com",
            "password_hash": password_hash,
            "is_admin": False,
            "preferred_model": "moondream",
            "auto_analyze": True
        })

        db.commit()
        db.close()

        print("✅ Utente test@example.com creato/aggiornato con password: test123")
        return True

    except Exception as e:
        print(f"❌ Errore creazione utente: {e}")
        return False

if __name__ == "__main__":
    success = create_default_user()
    sys.exit(0 if success else 1)
