FROM python:3.11-slim

# Set the working directory
WORKDIR /app

# Copy the HTML file
COPY index.html .

# Expose the port Cloud Run expects
EXPOSE 8080

# Serve the HTML file using Python's built-in HTTP server
CMD ["python", "-m", "http.server", "8080"]
