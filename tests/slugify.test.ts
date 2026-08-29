import slugify from '../src/utils/slugify';

describe('slugify', () => {
  it('should convert text to slug', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('should remove accents', () => {
    expect(slugify('Matériels électriques')).toBe('materiels-electriques');
  });

  it('should handle multiple spaces', () => {
    expect(slugify('hello   world')).toBe('hello-world');
  });

  it('should remove special characters', () => {
    expect(slugify('hello!@#$%world')).toBe('helloworld');
  });

  it('should trim leading and trailing dashes', () => {
    expect(slugify('  hello world  ')).toBe('hello-world');
  });

  it('should handle empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('should handle mixed case and accents', () => {
    expect(slugify('Catégorie Véhicules Légers')).toBe('categorie-vehicules-legers');
  });

  it('should replace multiple consecutive dashes', () => {
    expect(slugify('hello---world')).toBe('hello-world');
  });
});
