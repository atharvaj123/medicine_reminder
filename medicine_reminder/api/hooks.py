import frappe
from frappe.utils import today, nowdate
from .google_calendar import create_or_update_event, delete_event

ACTIVE_STATUSES = ["Active"]
INACTIVE_STATUSES = ["Stopped", "Completed", "Paused", "Inactive", "", None]

def create_medicine_events(doc, method):
    try:
        if doc.doctype != "Patient":
            return
        medicines = doc.get("medicines") or []
        for med in medicines:
            if not med.medicine_name:
                continue
            status = (med.status or "").strip()
            if status in INACTIVE_STATUSES:
                if med.google_event_id:
                    delete_event(med.google_event_id)
                    frappe.log_error("DELETE EVENT", f"{med.google_event_id} deleted (Inactive)")
                med.google_event_id = None
                continue
            # Completed if end date passed
            if med.end_date and med.end_date < nowdate():
                med.status = "Completed"
                if med.google_event_id:
                    delete_event(med.google_event_id)
                    med.google_event_id = None
                continue
            if status in ACTIVE_STATUSES:
                start_date = med.start_date or today()
                end_date = med.end_date or None
                repeat = (med.repetitiveness or "Daily").strip()
                event_id = med.google_event_id
                times_per_day = []
                if hasattr(med, "times_per_day") and med.times_per_day:
                    times_per_day = [t.strip() for t in str(med.times_per_day).split(",") if t.strip()]
                title = f"Take Medicine: {med.medicine_name}"
                new_event_id = create_or_update_event(
                    title=title,
                    start_date=str(start_date),
                    repetitiveness=repeat,
                    patient=doc.patient_name,
                    end_date=str(end_date) if end_date else None,
                    event_id=event_id,
                    times_per_day=times_per_day
                )
                if new_event_id != event_id:
                    med.google_event_id = new_event_id
        doc.flags.ignore_mandatory = True
    except Exception:
        frappe.log_error("MED EVENT ERROR", frappe.get_traceback())
        raise

def delete_medicine_event(doc, method):
    try:
        if getattr(doc, "google_event_id", None):
            delete_event(doc.google_event_id)
            frappe.log_error("DELETE EVENT", f"{doc.google_event_id} deleted (Row Removed)")
    except Exception:
        frappe.log_error("DELETE MED ERROR", frappe.get_traceback())
