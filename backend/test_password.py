#!/usr/bin/env python3
"""
Test password hashing and verification
"""
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Test password
test_password = "test123"

# Hash from init.sql
stored_hash = "$2b$12$RKmqZ/A1kcJC5dZuIsYVeO6.Pnbkq1zGO1TZzPUa3BxF7XQPp/bya"

# Verify
print(f"Testing password: {test_password}")
print(f"Stored hash: {stored_hash}")
print(f"Verification result: {pwd_context.verify(test_password, stored_hash)}")

# Generate new hash for comparison
new_hash = pwd_context.hash(test_password)
print(f"\nNew hash generated: {new_hash}")
print(f"New hash verification: {pwd_context.verify(test_password, new_hash)}")
