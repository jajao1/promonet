const definitions = [
  ["tenis", "Tênis", "Ofertas recentes de tênis masculinos, femininos e infantis."],
  ["ferramentas", "Ferramentas", "Promoções de ferramentas elétricas, manuais e acessórios."],
  ["celulares", "Celulares", "Ofertas de smartphones, acessórios e dispositivos móveis."],
  ["informatica", "Informática", "Promoções de computadores, periféricos e acessórios."],
  ["games", "Games", "Ofertas de consoles, controles, jogos e acessórios gamer."],
  ["eletrodomesticos", "Eletrodomésticos", "Promoções de eletrodomésticos para casa e cozinha."],
  ["beleza", "Beleza", "Ofertas de beleza, cuidados pessoais e perfumaria."],
  ["esportes", "Esportes", "Promoções de artigos esportivos, treino e lazer."],
  ["automotivo", "Automotivo", "Ofertas de acessórios, peças e cuidados automotivos."],
  ["bebe", "Bebê", "Promoções de itens para bebês e cuidados infantis."],
];

export const storefrontCategories = Object.freeze(definitions.map(([slug, name, description]) => Object.freeze({ slug, name, description })));
const bySlug = new Map(storefrontCategories.map((category) => [category.slug, category]));
export const categoryBySlug = (slug) => bySlug.get(slug) ?? null;
