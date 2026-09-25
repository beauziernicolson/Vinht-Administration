// Helpers DOM partagés (remplacent les $ / $$ de l'ancien app.js).

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
