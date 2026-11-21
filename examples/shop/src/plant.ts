// Planted bugs, one per property, switched on by VITE_PLANT (a comma list:
// `VITE_PLANT=leak npx bombadil-kit run`). Off, the app is correct and a
// sweep should find nothing; on, the property in ../plants.json should fire.
const plants = new Set(String(import.meta.env.VITE_PLANT ?? '').split(',').filter(Boolean));

export const planted = (name: string) => plants.has(name);
