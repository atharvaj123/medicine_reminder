// Copyright (c) 2025, Atharva Joshi and contributors
// For license information, please see license.txt

frappe.ui.form.on("Patient", {
    refresh(frm) {
        debounce_compute_medicine_progress(frm);
    },
    medicines_add(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        process_medicine_row_debounced(frm, row, cdt, cdn);
        debounce_compute_medicine_progress(frm);
    },
    medicines_remove(frm) {
        debounce_compute_medicine_progress(frm);
    }
});

frappe.ui.form.on("Medicine", {
    start_date(frm, cdt, cdn) {
        process_medicine_row_debounced(frm, locals[cdt][cdn], cdt, cdn);
        debounce_compute_medicine_progress(frm);
    },
    repetitiveness(frm, cdt, cdn) {
        process_medicine_row_debounced(frm, locals[cdt][cdn], cdt, cdn);
        debounce_compute_medicine_progress(frm);
    },
    repetition_count(frm, cdt, cdn) {
        process_medicine_row_debounced(frm, locals[cdt][cdn], cdt, cdn);
        debounce_compute_medicine_progress(frm);
    },
    times_per_day(frm, cdt, cdn) {
        process_medicine_row_debounced(frm, locals[cdt][cdn], cdt, cdn);
    },
    medicine_name(frm, cdt, cdn) {
        process_medicine_row_debounced(frm, locals[cdt][cdn], cdt, cdn);
        debounce_compute_medicine_progress(frm);
    },
    status(frm, cdt, cdn) {
        process_medicine_row_debounced(frm, locals[cdt][cdn], cdt, cdn);
        debounce_compute_medicine_progress(frm);
    }
});

// Debounce helpers
let _mr_timers = {};
function debounce(key, fn, delay = 250) {
    if (_mr_timers[key]) {
        clearTimeout(_mr_timers[key]);
    }
    _mr_timers[key] = setTimeout(() => {
        try {
            fn();
        } catch (e) {
            console.error(e);
        } finally {
            delete _mr_timers[key];
        }
    }, delay);
}

function process_medicine_row_debounced(frm, row, cdt, cdn) {
    debounce(cdt + cdn, () => process_medicine_row(frm, row, cdt, cdn), 200);
}

function debounce_compute_medicine_progress(frm) {
    debounce("compute_progress_" + frm.docname, () => compute_medicine_progress(frm), 200);
}

function process_medicine_row(frm, row, cdt, cdn) {
    try {
        // Validate repetition_count
        if (row.repetition_count !== undefined && row.repetition_count !== null && row.repetition_count !== "") {
            let rc = parseInt(row.repetition_count);
            if (isNaN(rc) || rc <= 0) {
                frappe.msgprint("Repetition count must be a positive integer.", "Validation");
                frappe.model.set_value(cdt, cdn, "repetition_count", 1);
                return;
            }
        }

        // Validate times_per_day
        if (row.times_per_day && typeof row.times_per_day === "string") {
            // Accept comma-separated times, e.g., "09:00,19:00"
            let arr = row.times_per_day.split(",").map(s => s.trim()).filter(Boolean);
            if (arr.length === 0) {
                frappe.msgprint("Specify at least one time per day.", "Validation");
                frappe.model.set_value(cdt, cdn, "times_per_day", "09:00");
            }
        }

        // Auto-calculate END DATE
        if (row.start_date && row.repetitiveness) {
            let rc = parseInt(row.repetition_count || 1);
            let repet = (row.repetitiveness || "").toLowerCase();
            let start = row.start_date;
            let end = null;
            if (repet === "daily") {
                end = frappe.datetime.add_days(start, rc - 1);
            } else if (repet === "weekly") {
                end = frappe.datetime.add_days(start, (rc - 1) * 7);
            } else if (repet === "monthly") {
                if (frappe.datetime.add_months) {
                    let obj = frappe.datetime.str_to_obj(start);
                    let dt = frappe.datetime.add_months(obj, rc - 1);
                    end = frappe.datetime.obj_to_str(dt);
                } else {
                    end = frappe.datetime.add_days(start, (rc - 1) * 30);
                }
            }
            if (end && has_child_field("Medicine", "end_date")) {
                if (row.end_date !== end) {
                    frappe.model.set_value(cdt, cdn, "end_date", end);
                }
            }
        }

        // Validate END DATE >= START DATE
        if (row.start_date && row.end_date) {
            let s = frappe.datetime.str_to_obj(row.start_date);
            let e = frappe.datetime.str_to_obj(row.end_date);
            if (e < s) {
                frappe.msgprint("End Date cannot be before Start Date.", "Validation");
                frappe.model.set_value(cdt, cdn, "end_date", row.start_date);
            }
        }

        // NEXT DOSE calculation
        if (has_child_field("Medicine", "next_dose") && row.start_date && row.repetitiveness) {
            let next = compute_next_dose(row);
            if (next && row.next_dose !== next) {
                frappe.model.set_value(cdt, cdn, "next_dose", next);
            }
        }

        // Auto-mark completed if end date passed
        if (row.end_date && has_child_field("Medicine", "status")) {
            let today = frappe.datetime.get_today();
            if (frappe.datetime.str_to_obj(row.end_date) < frappe.datetime.str_to_obj(today)) {
                if ((row.status || "").toLowerCase() !== "completed") {
                    frappe.model.set_value(cdt, cdn, "status", "Completed");
                    // Force sync; you may want to trigger a save here
                    frm.save();
                }
            }
        }
    } catch (err) {
        console.error("process_medicine_row ERROR:", err);
    }
}

function compute_next_dose(row) {
    if (!row.start_date || !row.repetitiveness) return null;
    let today = frappe.datetime.get_today();
    let next = row.start_date;
    let repet = (row.repetitiveness || "").toLowerCase();
    if (frappe.datetime.str_to_obj(next) >= frappe.datetime.str_to_obj(today)) return next;
    let max_iterations = 400;
    if (row.repetition_count) {
        let rc = parseInt(row.repetition_count) || 1;
        max_iterations = Math.min(max_iterations, rc + 5);
    }
    let end_obj = null;
    if (row.end_date) {
        end_obj = frappe.datetime.str_to_obj(row.end_date);
    }
    let guard = 0;
    while (frappe.datetime.str_to_obj(next) < frappe.datetime.str_to_obj(today) && guard < max_iterations) {
        if (repet === "daily") {
            next = frappe.datetime.add_days(next, 1);
        } else if (repet === "weekly") {
            next = frappe.datetime.add_days(next, 7);
        } else if (repet === "monthly") {
            if (frappe.datetime.add_months) {
                let obj = frappe.datetime.str_to_obj(next);
                let dt = frappe.datetime.add_months(obj, 1);
                next = frappe.datetime.obj_to_str(dt);
            } else {
                next = frappe.datetime.add_days(next, 30);
            }
        } else {
            break;
        }
        guard++;
        if (end_obj && frappe.datetime.str_to_obj(next) > end_obj) return null;
    }
    if (guard >= max_iterations && frappe.datetime.str_to_obj(next) < frappe.datetime.str_to_obj(today)) return null;
    return next;
}

function compute_medicine_progress(frm) {
    let meds = frm.doc.medicines || [];
    let total = meds.length;
    if (total === 0) {
        if (frm.fields_dict.medicine_progress) {
            frm.set_value("medicine_progress", 0);
        }
        return;
    }
    let completed = meds.filter(r => (r.status || "").toLowerCase() === "completed").length;
    let percent = Math.round((completed / total) * 100);
    if (frm.fields_dict.medicine_progress) {
        frm.set_value("medicine_progress", percent);
    }
}

function has_child_field(doctype, fieldname) {
    try {
        return !!frappe.meta.get_docfield(doctype, fieldname);
    } catch (e) {
        return false;
    }
}
