import logging
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import quote

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaFileUpload

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("beast-snax")
SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
]
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
OWNER_ID = os.environ["SUPABASE_OWNER_USER_ID"]
FOLDER_ID = os.environ["GOOGLE_DRIVE_FOLDER_ID"]
MAX_UPLOAD_BYTES = 256 * 1024 * 1024


def google_credentials():
    credentials = Credentials(
        token=None,
        refresh_token=os.environ["GOOGLE_REFRESH_TOKEN"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        scopes=SCOPES,
    )
    credentials.refresh(Request())
    return credentials


def supabase_request(method, path, **kwargs):
    headers = kwargs.pop("headers", {})
    headers.update({"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"})
    response = requests.request(method, f"{SUPABASE_URL}/rest/v1/{path}", headers=headers, timeout=60, **kwargs)
    response.raise_for_status()
    return response.json() if response.content else None


def scan_drive(service):
    rows = supabase_request("GET", f"shorts_queue?select=drive_file_id&owner_user_id=eq.{quote(OWNER_ID)}") or []
    known = {row["drive_file_id"] for row in rows}
    page_token, added = None, 0
    while True:
        result = service.files().list(
            q=f"'{FOLDER_ID}' in parents and trashed = false and mimeType = 'video/mp4'",
            pageSize=100, pageToken=page_token, orderBy="createdTime",
            fields="nextPageToken,files(id,name,size,mimeType)"
        ).execute()
        for item in result.get("files", []):
            if item["id"] in known:
                continue
            title = re.sub(r"[_-]+"," ",Path(item.get("name","New Short")).stem).strip()[:100] or "New Short"
            row = {
                "owner_user_id": OWNER_ID, "drive_file_id": item["id"],
                "file_name": item.get("name","video.mp4"), "file_size": int(item.get("size",0)),
                "mime_type": item.get("mimeType","video/mp4"), "title": title,
                "description": "Add your original description and review this Short before approving.",
                "tags": ["shorts"], "status": "pending"
            }
            supabase_request("POST","shorts_queue",json=row,headers={"Prefer":"resolution=ignore-duplicates,return=minimal"})
            known.add(item["id"]); added += 1
            LOG.info("Added to review queue: %s",item.get("name"))
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    LOG.info("Drive scan complete. New videos queued: %s",added)


def next_approved():
    rows = supabase_request(
        "GET","shorts_queue?select=*&owner_user_id=eq."+quote(OWNER_ID)+"&status=eq.approved&order=created_at.asc&limit=1"
    ) or []
    return rows[0] if rows else None


def patch_row(row_id, values):
    supabase_request("PATCH",f"shorts_queue?id=eq.{quote(row_id)}&owner_user_id=eq.{quote(OWNER_ID)}",
                     json=values,headers={"Prefer":"return=minimal"})


def publish_one(credentials, drive, youtube):
    row = next_approved()
    if not row:
        LOG.info("No approved Shorts to publish today.")
        return
    if not row.get("title","").strip():
        LOG.warning("Approved row has no title; skipping %s",row["id"])
        return
    try:
        metadata = drive.files().get(fileId=row["drive_file_id"],fields="id,name,size,mimeType").execute()
        size = int(metadata.get("size",0))
        if size <= 0:
            raise ValueError("Drive returned an empty file.")
        if size > MAX_UPLOAD_BYTES:
            raise ValueError(f"File exceeds 256 MB safety limit ({size} bytes).")
        with TemporaryDirectory() as temp_dir:
            local_path = os.path.join(temp_dir,"short.mp4")
            request = drive.files().get_media(fileId=row["drive_file_id"])
            with open(local_path,"wb") as output:
                downloader = MediaIoBaseDownload(output,request,chunksize=8*1024*1024)
                done = False
                while not done:
                    status,done = downloader.next_chunk()
                    if status:
                        LOG.info("Drive download: %d%%",int(status.progress()*100))
            publish_at = (datetime.now(timezone.utc)+timedelta(minutes=15)).replace(microsecond=0)
            body = {
                "snippet":{
                    "title":row["title"][:100],"description":(row.get("description") or "")[:5000],
                    "categoryId":"22","tags":(row.get("tags") or ["shorts"])[:30]
                },
                "status":{"privacyStatus":"private","publishAt":publish_at.isoformat().replace("+00:00","Z"),
                          "selfDeclaredMadeForKids":False}
            }
            media = MediaFileUpload(local_path,mimetype="video/mp4",chunksize=8*1024*1024,resumable=True)
            response = youtube.videos().insert(part="snippet,status",body=body,media_body=media).execute()
            video_id = response["id"]
            patch_row(row["id"],{
                "status":"scheduled","youtube_video_id":video_id,
                "youtube_url":f"https://www.youtube.com/watch?v={video_id}",
                "publish_at":publish_at.isoformat(),"error_message":None,
                "updated_at":datetime.now(timezone.utc).isoformat()
            })
            LOG.info("Scheduled: https://www.youtube.com/watch?v=%s",video_id)
    except Exception as exc:
        LOG.exception("Upload failed for %s",row.get("file_name"))
        patch_row(row["id"],{"status":"error","error_message":str(exc)[:1000],
                              "updated_at":datetime.now(timezone.utc).isoformat()})
        raise


def main():
    credentials = google_credentials()
    drive = build("drive","v3",credentials=credentials,cache_discovery=False)
    youtube = build("youtube","v3",credentials=credentials,cache_discovery=False)
    scan_drive(drive)
    if os.getenv("PUBLISH_ENABLED","true").lower() == "true":
        publish_one(credentials,drive,youtube)
    else:
        LOG.info("Scan-only run complete; publishing disabled.")


if __name__ == "__main__":
    required = ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_OWNER_USER_ID",
                "GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REFRESH_TOKEN","GOOGLE_DRIVE_FOLDER_ID"]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        LOG.error("Missing required environment variables: %s",", ".join(missing))
        sys.exit(2)
    main()
