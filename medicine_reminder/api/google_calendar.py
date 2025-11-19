import datetime
import frappe
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

TARGET_CALENDAR_ID = "joshia347@gmail.com"
DEFAULT_TZ = "Asia/Kolkata"

DEFAULT_TIMES_PER_DAY = ["09:00"]

def get_calendar_service():
    try:
        cred_path = frappe.get_site_path("private", "files", "medicine_credential.json")
        scopes = ["https://www.googleapis.com/auth/calendar"]
        creds = Credentials.from_service_account_file(cred_path, scopes=scopes)
        return build("calendar", "v3", credentials=creds)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Google Calendar Auth Error")
        raise

def build_rrule(repetitiveness: str, start_date: str = None, end_date: str = None):
    rep = (repetitiveness or "").strip().lower()
    freq_map = {"daily": "DAILY", "weekly": "WEEKLY", "monthly": "MONTHLY"}
    freq = freq_map.get(rep)
    # If no recurrence or single-day event, return None
    if not freq or not end_date or start_date == end_date:
        return None
    end_dt = datetime.datetime.strptime(end_date, "%Y-%m-%d")
    until_str = end_dt.strftime("%Y%m%dT235900Z")
    return f"RRULE:FREQ={freq};UNTIL={until_str}"

def create_or_update_event(
    title: str,
    start_date: str,
    repetitiveness: str,
    patient: str = None,
    event_id: str = None,
    end_date: str = None,
    reminder_minutes: int = 10,
    times_per_day: list = None
):
    try:
        service = get_calendar_service()
    except Exception:
        return None

    if times_per_day is None or not times_per_day:
        times_per_day = DEFAULT_TIMES_PER_DAY

    if isinstance(times_per_day, str):
        times_per_day = [t.strip() for t in times_per_day.split(",") if t.strip()]

    existing_ids = []
    if event_id:
        existing_ids = [x.strip() for x in event_id.split(",") if x.strip()]

    rrule = build_rrule(repetitiveness, start_date, end_date)
    created_ids = []

    for idx, time_str in enumerate(times_per_day):
        try:
            hh, mm = map(int, time_str.split(":"))
        except:
            hh, mm = 9, 0

        start_dt = datetime.datetime.strptime(start_date, "%Y-%m-%d").replace(hour=hh, minute=mm, second=0)
        end_dt = start_dt + datetime.timedelta(hours=1)
        body = {
            "summary": title,
            "description": f"Medicine reminder for patient {patient or ''}",
            "start": {"dateTime": start_dt.isoformat(), "timeZone": DEFAULT_TZ},
            "end": {"dateTime": end_dt.isoformat(), "timeZone": DEFAULT_TZ},
            "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": reminder_minutes}]},
        }
        if rrule:
            body["recurrence"] = [rrule]
        eid = existing_ids[idx] if idx < len(existing_ids) else None
        try:
            if eid:
                updated = service.events().update(
                    calendarId=TARGET_CALENDAR_ID,
                    eventId=eid,
                    body=body
                ).execute()
                created_ids.append(updated.get("id"))
                frappe.log_error("Google Event Updated", updated.get("htmlLink"))
            else:
                created = service.events().insert(
                    calendarId=TARGET_CALENDAR_ID,
                    body=body
                ).execute()
                created_ids.append(created.get("id"))
                frappe.log_error("Google Event Created", created.get("htmlLink"))

        except Exception:
            frappe.log_error(frappe.get_traceback(), "Google Event Create/Update Error")
    if not created_ids:
        return None
    return ",".join(created_ids)

def delete_event(event_id: str):
    if not event_id:
        return False
    try:
        service = get_calendar_service()
    except Exception:
        return False
    ids = [x.strip() for x in event_id.split(",") if x.strip()]
    deleted_any = False
    for eid in ids:
        try:
            service.events().delete(
                calendarId=TARGET_CALENDAR_ID,
                eventId=eid
            ).execute()
            frappe.log_error("Google Event Deleted", eid)
            deleted_any = True
        except Exception:
            frappe.log_error(frappe.get_traceback(), f"Delete failed for {eid}")
    return deleted_any
