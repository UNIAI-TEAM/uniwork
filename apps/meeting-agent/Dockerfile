# uniwork-scribe (apps/meeting-agent, ADR 0036). Build from this directory:
#   docker build -t uniwork-meeting-agent apps/meeting-agent
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agent.py .
COPY scribe ./scribe
# Silero and the turn models ship with the plugins; this fetches anything a
# plugin downloads lazily so a pod never reaches the internet at start.
RUN python agent.py download-files
RUN useradd --uid 1000 --create-home scribe
USER 1000
EXPOSE 8081
CMD ["python", "agent.py", "start"]
