<div align="center">
    <h1>Bible Search</h1>
    <p>Welcome to Bible Search, a semantic search application that helps you discover Bible verses in a more intuitive way. Instead of relying on keyword matching, this tool uses sentence embeddings to find verses that are contextually and semantically similar to your query.</p>
    <p>
        <img alt="Python" src="https://img.shields.io/badge/-Python-3776AB?style=flat-square&logo=python&logoColor=white" />
        <img alt="FastAPI" src="https://img.shields.io/badge/-FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" />
        <img alt="React" src="https://img.shields.io/badge/-React-61DAFB?style=flat-square&logo=react&logoColor=black" />
        <img alt="Vite" src="https://img.shields.io/badge/-Vite-646CFF?style=flat-square&logo=vite&logoColor=white" />
    </p>
</div>

## How It Works

This project is composed of two main parts: a backend API and a frontend client.

[How it works](https://ethanglenn.dev/blog/bible-search) - A detailed blog post explaining the architecture and implementation of the Bible Search application.

### Backend API

The API is built with **Python** and **FastAPI**. It leverages the power of sentence transformers and a FAISS (Facebook AI Similarity Search) index to perform lightning-fast semantic searches.

-   **Sentence Transformers**: The `paraphrase-MiniLM-L3-v2` model is used to convert the entire Bible (verse by verse) into high-dimensional vector embeddings. The same model is used to encode user queries at runtime.
-   **FAISS**: The vector embeddings of the Bible verses are stored in a FAISS index. This allows for incredibly efficient similarity searches, finding the closest matches to a query vector from over 31,000 verses in milliseconds.
-   **FastAPI**: Provides a simple and fast web server to expose the search functionality through a REST API endpoint.

### Frontend Client

The client is a modern, responsive web application built with **React** and **Vite**.

-   **React**: Used to build the user interface, providing a dynamic and interactive experience.
-   **Vite**: A next-generation frontend tooling that provides a faster and leaner development experience.
-   **Tailwind CSS**: For styling the application with a utility-first CSS framework.

## Getting Started Locally

To run this project on your local machine, you'll need to have **Node.js** and **Python** installed.

### 1. Backend API Setup

First, set up and run the backend server.

```bash
# Navigate to the api directory
cd api

# It's recommended to use a virtual environment
python -m venv venv
# On Windows
venv\Scripts\activate
# On macOS/Linux
source venv/bin/activate

# Install the required Python packages
pip install -r requirements.txt

# Run the FastAPI server
# The server will be available at http://localhost:10000
uvicorn app:app --host 0.0.0.0 --port 10000
```

### 2. Frontend Client Setup

Next, set up and run the frontend client in a separate terminal.

```bash
# Navigate to the client directory
cd client

# Install the required npm packages
npm install

# Run the development server
# The application will be available at http://localhost:5173
npm run dev
```

Once both the backend and frontend are running, you can open your browser and navigate to `http://localhost:5173` to use the application.

## Docker

A `Dockerfile` is provided to containerize the backend API.

```bash
# Build the Docker image from the root directory
docker build -t bible-search-api .

# Run the container
# This will map port 10000 on your host to port 10000 in the container
docker run -p 10000:10000 bible-search-api
```
