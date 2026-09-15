const definitions = [
  ["tenis", "sneakers", "Tênis", "Ofertas recentes de tênis masculinos, femininos e infantis."],
  ["roupas", "clothing", "Roupas", "Ofertas de roupas masculinas, femininas e infantis."],
  ["acessorios-de-moda", "fashion-accessories", "Acessórios de Moda", "Promoções de acessórios de moda para diferentes estilos."],
  ["ferramentas", "tools", "Ferramentas", "Promoções de ferramentas elétricas, manuais e acessórios."],
  ["celulares", "phones", "Celulares", "Ofertas de smartphones, acessórios e dispositivos móveis."],
  ["informatica", "computing", "Informática", "Promoções de computadores, periféricos e acessórios."],
  ["games", "games", "Games", "Ofertas de consoles, controles, jogos e acessórios gamer."],
  ["eletrodomesticos", "appliances", "Eletrodomésticos", "Promoções de eletrodomésticos para casa e cozinha."],
  ["beleza", "beauty", "Beleza", "Ofertas de beleza, cuidados pessoais e perfumaria."],
  ["esportes", "sports", "Esportes", "Promoções de artigos esportivos, treino e lazer."],
  ["automotivo", "automotive", "Automotivo", "Ofertas de acessórios, peças e cuidados automotivos."],
  ["bebe", "baby", "Bebê", "Promoções de itens para bebês e cuidados infantis."],
];

export const storefrontCategories = Object.freeze(definitions.map(([slug, nicheId, name, description]) => Object.freeze({ slug, nicheId, name, description })));
const bySlug = new Map(storefrontCategories.map((category) => [category.slug, category]));
const byNicheId = new Map(storefrontCategories.map((category) => [category.nicheId, category]));
export const categoryBySlug = (slug) => bySlug.get(slug) ?? null;
export const categoryByNicheId = (nicheId) => byNicheId.get(nicheId) ?? null;
