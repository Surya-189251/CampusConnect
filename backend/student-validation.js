const fields = ['rollNumber','fullName','email','mobile','department','admissionYear','semester','section'];
function validateStudents(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
    return { students: [], errors: ['Provide between 1 and 100 students per batch.'] };
  }
  const errors = [], rolls = new Set(), emails = new Set();
  const students = input.map((raw, index) => {
    const row = Object.fromEntries(fields.map(k => [k, typeof raw?.[k] === 'string' || typeof raw?.[k] === 'number' ? String(raw[k]).trim() : '']));
    const issue = message => errors.push(`Row ${index + 1}: ${message}`);
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(row.rollNumber)) issue('Roll number must contain 1–50 letters, numbers, hyphens or underscores.');
    if (!row.fullName || row.fullName.length > 120) issue('Name is required (maximum 120 characters).');
    row.email = row.email.toLowerCase();
    if (row.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) issue('A valid email is required.');
    row.mobile = row.mobile.replace(/[\s()-]/g, '').replace(/^(?:\+91|91)(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(row.mobile)) issue('Enter a 10-digit Indian mobile number, optionally prefixed by +91.');
    if (!row.department || row.department.length > 100) issue('Department is required (maximum 100 characters).');
    if (!/^\d{4}$/.test(row.admissionYear) || +row.admissionYear < 2000 || +row.admissionYear > 2100) issue('Admission year must be 2000–2100.');
    if (!/^[1-8]$/.test(row.semester)) issue('Semester must be 1–8.');
    if (!row.section || row.section.length > 20) issue('Section is required (maximum 20 characters).');
    const roll = row.rollNumber.toLowerCase();
    if (rolls.has(roll)) issue('Duplicate roll number in this batch.');
    if (emails.has(row.email)) issue('Duplicate email in this batch.');
    rolls.add(roll); emails.add(row.email);
    return row;
  });
  return { students, errors };
}
module.exports = { validateStudents };
