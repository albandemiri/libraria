CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE Users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR UNIQUE NOT NULL,
  password_hash VARCHAR NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Publishers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR NOT NULL,
  contact_email VARCHAR NOT NULL,
  bank_details JSONB
);

CREATE TABLE Books (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  publisher_id UUID REFERENCES Publishers(id),
  title VARCHAR NOT NULL,
  author VARCHAR NOT NULL,
  price DECIMAL NOT NULL,
  encrypted_file_url TEXT NOT NULL
);

CREATE TABLE Transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES Users(id),
  book_id UUID REFERENCES Books(id),
  amount DECIMAL NOT NULL,
  status VARCHAR NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  payment_gateway_ref VARCHAR
);

CREATE TABLE User_Libraries (
  user_id UUID REFERENCES Users(id),
  book_id UUID REFERENCES Books(id),
  reading_progress TEXT,
  last_read TIMESTAMP,
  PRIMARY KEY (user_id, book_id)
);
