CREATE UNIQUE INDEX CONCURRENTLY idx_users_apple_id ON users(apple_id) WHERE apple_id IS NOT NULL;
