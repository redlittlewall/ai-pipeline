import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiCatalogService } from './AiCatalog.service';
import { BodyPart } from 'model/tattoo/BodyPart.Entity';
import { TattooSize } from 'model/tattoo/TattooSize.entity';
import { TattooColor } from 'model/TattooColor.Entity';
import { Style } from 'model/tattoo/Style.entity';

describe('AiCatalogService', () => {
  let service: AiCatalogService;
  let bodyPartRepository: any;
  let tattooSizeRepository: any;
  let tattooColorRepository: any;
  let styleRepository: any;

  beforeEach(async () => {
    const createQueryBuilderMock = () => {
      const qb: any = new Proxy(
        {},
        {
          get(target, prop) {
            if (prop === 'then') return undefined;
            if (!(prop in target)) {
              target[prop] = jest.fn().mockImplementation((...args: any[]) => {
                if (args.length > 0 && typeof args[0] === 'function') {
                  args[0](qb);
                } else if (
                  args.length > 0 &&
                  args[0] &&
                  typeof args[0].whereFactory === 'function'
                ) {
                  args[0].whereFactory(qb);
                }
                return qb;
              });
            }
            return target[prop];
          },
        },
      );
      qb.getOne = jest.fn().mockResolvedValue(null);
      qb.getMany = jest.fn().mockResolvedValue([]);
      qb.getRawOne = jest.fn().mockResolvedValue(null);
      qb.getRawMany = jest.fn().mockResolvedValue([]);
      qb.getCount = jest.fn().mockResolvedValue(0);
      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      qb.execute = jest.fn().mockResolvedValue({ affected: 1, raw: [] });
      return qb;
    };

    const createMockRepository = () => {
      const qb = createQueryBuilderMock();
      return {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([]),
        findAndCount: jest.fn().mockResolvedValue([[], 0]),
        save: jest
          .fn()
          .mockImplementation((e: any) =>
            Promise.resolve({ id: 'mock-id', ...(e || {}) }),
          ),
        create: jest.fn().mockImplementation((e: any) => e),
        update: jest
          .fn()
          .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
        delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        softDelete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        restore: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        count: jest.fn().mockResolvedValue(0),
        exist: jest.fn().mockResolvedValue(false),
        remove: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
    };
    bodyPartRepository = createMockRepository();
    tattooSizeRepository = createMockRepository();
    tattooColorRepository = createMockRepository();
    styleRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiCatalogService,
        {
          provide: getRepositoryToken(BodyPart),
          useValue: bodyPartRepository,
        },
        {
          provide: getRepositoryToken(TattooSize),
          useValue: tattooSizeRepository,
        },
        {
          provide: getRepositoryToken(TattooColor),
          useValue: tattooColorRepository,
        },
        {
          provide: getRepositoryToken(Style),
          useValue: styleRepository,
        },
      ],
    }).compile();

    service = module.get<AiCatalogService>(AiCatalogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should execute onModuleInit successfully and load catalog', async () => {
      // Given (Arrange)
      bodyPartRepository.find.mockResolvedValueOnce([
        { id: 'bp-1', name: 'Braço' },
      ] as any);
      tattooSizeRepository.find.mockResolvedValueOnce([
        { id: 'sz-1', lowerLimit: 5, higherLimit: 10 },
      ] as any);
      tattooColorRepository.find.mockResolvedValueOnce([
        { id: 'col-1', color: 'Preto' },
      ] as any);
      styleRepository.find.mockResolvedValueOnce([
        { id: 'st-1', name: 'Realismo' },
      ] as any);

      // When (Act)
      const result = await service.onModuleInit();

      // Then (Assert)
      expect(result).toBeUndefined();
      expect(service.hasCatalog()).toBe(true);
      expect(service.getBodyParts()).toHaveLength(1);
    });
  });

  describe('handleDailyReload', () => {
    it('should execute handleDailyReload successfully', async () => {
      // Given (Arrange)
      bodyPartRepository.find.mockResolvedValueOnce([] as any);

      // When (Act)
      const result = await service.handleDailyReload();

      // Then (Assert)
      expect(result).toBeUndefined();
      expect(bodyPartRepository.find).toHaveBeenCalled();
    });
  });

  describe('loadCatalog', () => {
    it('should execute loadCatalog successfully and rebuild indexes with complex objects and stringified JSONs', async () => {
      // Given (Arrange)
      const mockBodyParts = [
        { id: 'bp-1', name: JSON.stringify({ pt: 'Braço', en: 'Arm' }) },
        { id: 'bp-2', name: { pt: 'Perna', en: 'Leg' } },
        { id: 'bp-3', name: 'Costas' },
        { id: 'bp-4', name: '{ invalid json' },
      ];
      const mockSizes = [
        { id: 'sz-1', lowerLimit: 5, higherLimit: 10 },
        { id: 'sz-2', lowerLimit: 15, higherLimit: null },
        { id: 'sz-3', lowerLimit: null, higherLimit: null },
      ];
      const mockColors = [
        {
          id: 'col-black',
          color: JSON.stringify({ pt: 'Preto', en: 'Black' }),
        },
        { id: 'col-multi', color: { pt: 'Multicolorido', en: 'Multicolor' } },
        { id: 'col-violet', color: 'Violeta' },
        { id: 'col-indigo', color: 'Indigo' },
        { id: 'col-invalid', color: '{ invalid json' },
      ];
      const mockStyles = [
        {
          id: 'st-1',
          name: JSON.stringify({ pt: 'Blackwork', en: 'Blackwork' }),
        },
        { id: 'st-2', name: { pt: 'Realismo', en: 'Realism' } },
        { id: 'st-3', name: 'Oriental' },
        { id: 'st-4', name: '{ invalid json' },
      ];

      bodyPartRepository.find.mockResolvedValueOnce(mockBodyParts as any);
      tattooSizeRepository.find.mockResolvedValueOnce(mockSizes as any);
      tattooColorRepository.find.mockResolvedValueOnce(mockColors as any);
      styleRepository.find.mockResolvedValueOnce(mockStyles as any);

      // When (Act)
      await service.loadCatalog();

      // Then (Assert)
      expect(service.hasCatalog()).toBe(true);
      expect(service.resolveBodyPartId('Braço')).toBe('bp-1');
      expect(service.resolveBodyPartId('Arm')).toBe('bp-1');
      expect(service.resolveBodyPartId('Perna')).toBe('bp-2');
      expect(service.resolveBodyPartId('Costas')).toBe('bp-3');
      expect(service.getBlackGreyColorId()).toBe('col-black');
      expect(service.getColorfulColorId()).toBe('col-multi');
      expect(service.resolveColorIdByName('roxo')).toBe('col-violet');
      expect(service.resolveColorIdByName('anil')).toBe('col-indigo');
      expect(service.resolveStyleId('Realismo')).toBe('st-2');
    });

    it('should handle catalog load error gracefully', async () => {
      // Given (Arrange)
      bodyPartRepository.find.mockRejectedValueOnce(
        new Error('Database error'),
      );

      // When & Then
      await expect(service.loadCatalog()).resolves.toBeUndefined();
    });
  });

  describe('resolveBodyPartId', () => {
    it('should return correct bodyPart ID for valid name', async () => {
      // Given (Arrange)
      bodyPartRepository.find.mockResolvedValueOnce([
        { id: 'bp-1', name: 'Braço' },
      ] as any);
      await service.loadCatalog();

      // When (Act)
      const result = service.resolveBodyPartId('braço');

      // Then (Assert)
      expect(result).toBe('bp-1');
    });

    it('should return null if bodyPart name is not found or invalid', () => {
      // Given / When
      const result1 = service.resolveBodyPartId('Inexistente');
      const result2 = service.resolveBodyPartId(null as any);
      const result3 = service.resolveBodyPartId(123 as any);

      // Then
      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(result3).toBeNull();
    });
  });

  describe('resolveSizeId', () => {
    it('should resolve size ID by exact limit match', async () => {
      // Given (Arrange)
      tattooSizeRepository.find.mockResolvedValueOnce([
        { id: 'sz-1', lowerLimit: 5, higherLimit: 10 },
      ] as any);
      await service.loadCatalog();

      // When (Act)
      const result = service.resolveSizeId(5, 10);

      // Then (Assert)
      expect(result).toBe('sz-1');
    });

    it('should fallback to range check when lower and upper are within interval', async () => {
      // Given (Arrange)
      tattooSizeRepository.find.mockResolvedValueOnce([
        { id: 'sz-1', lowerLimit: 5, higherLimit: 20 },
      ] as any);
      await service.loadCatalog();

      // When (Act)
      const result = service.resolveSizeId(8, 15);

      // Then (Assert)
      expect(result).toBe('sz-1');
    });

    it('should return null when no range matches or parameters are invalid', () => {
      expect(service.resolveSizeId(100, 200)).toBeNull();
      expect(service.resolveSizeId(NaN, 10)).toBeNull();
    });
  });

  describe('resolveSizeByName', () => {
    it('should resolve size by direct label match, "fechamento", and extracted numbers', async () => {
      // Given (Arrange)
      tattooSizeRepository.find.mockResolvedValueOnce([
        { id: 'sz-closure', lowerLimit: null, higherLimit: null },
        { id: 'sz-10-20', lowerLimit: 10, higherLimit: 20 },
        { id: 'sz-15-plus', lowerLimit: 15, higherLimit: null },
      ] as any);
      await service.loadCatalog();

      // When & Then
      expect(service.resolveSizeByName('fechamento')).toBe('sz-closure');
      expect(service.resolveSizeByName('10 cm - 20 cm')).toBe('sz-10-20');
      expect(service.resolveSizeByName('10 a 20')).toBe('sz-10-20');
      expect(service.resolveSizeByName('15 cm +')).toBe('sz-15-plus');
      expect(service.resolveSizeByName('15 mais')).toBe('sz-15-plus');
      expect(service.resolveSizeByName(null as any)).toBeNull();
      expect(service.resolveSizeByName('qualquer texto sem numero')).toBeNull();
    });
  });

  describe('getBodyPartNames', () => {
    it('should return list of body part names in Portuguese', async () => {
      // Given (Arrange)
      bodyPartRepository.find.mockResolvedValueOnce([
        { id: 'bp-1', name: JSON.stringify({ pt: 'Braço' }) },
        { id: 'bp-2', name: { pt: 'Perna' } },
        { id: 'bp-3', name: 'Costas' },
        { id: 'bp-4', name: '{ invalid json' },
      ] as any);
      await service.loadCatalog();

      // When (Act)
      const result = service.getBodyPartNames();

      // Then (Assert)
      expect(result).toEqual(['Braço', 'Perna', 'Costas', '{ invalid json']);
    });
  });

  describe('getSizeLabels', () => {
    it('should return descriptive labels for tattoo sizes', async () => {
      // Given (Arrange)
      tattooSizeRepository.find.mockResolvedValueOnce([
        { id: 'sz-1', lowerLimit: null, higherLimit: null },
        { id: 'sz-2', lowerLimit: 15, higherLimit: null },
        { id: 'sz-3', lowerLimit: 5, higherLimit: 10 },
      ] as any);
      await service.loadCatalog();

      // When (Act)
      const result = service.getSizeLabels();

      // Then (Assert)
      expect(result).toEqual(['fechamento', '15 cm +', '5 cm - 10 cm']);
    });
  });

  describe('hasCatalog', () => {
    it('should return false if catalog is empty and true when loaded', async () => {
      expect(service.hasCatalog()).toBe(false);

      bodyPartRepository.find.mockResolvedValueOnce([
        { id: 'bp-1', name: 'Braço' },
      ] as any);
      tattooSizeRepository.find.mockResolvedValueOnce([
        { id: 'sz-1', lowerLimit: 5, higherLimit: 10 },
      ] as any);
      await service.loadCatalog();

      expect(service.hasCatalog()).toBe(true);
    });
  });

  describe('getBodyParts', () => {
    it('should return bodyPartsCache array', async () => {
      const mockParts = [{ id: 'bp-1' }] as any;
      bodyPartRepository.find.mockResolvedValueOnce(mockParts);
      await service.loadCatalog();

      expect(service.getBodyParts()).toEqual(mockParts);
    });
  });

  describe('getSizes', () => {
    it('should return tattooSizesCache array', async () => {
      const mockSizes = [{ id: 'sz-1' }] as any;
      tattooSizeRepository.find.mockResolvedValueOnce(mockSizes);
      await service.loadCatalog();

      expect(service.getSizes()).toEqual(mockSizes);
    });
  });

  describe('getColors', () => {
    it('should return tattooColorsCache array', async () => {
      const mockColors = [{ id: 'col-1' }] as any;
      tattooColorRepository.find.mockResolvedValueOnce(mockColors);
      await service.loadCatalog();

      expect(service.getColors()).toEqual(mockColors);
    });
  });

  describe('getStyles', () => {
    it('should return stylesCache array', async () => {
      const mockStyles = [{ id: 'st-1' }] as any;
      styleRepository.find.mockResolvedValueOnce(mockStyles);
      await service.loadCatalog();

      expect(service.getStyles()).toEqual(mockStyles);
    });
  });

  describe('getStyleNames', () => {
    it('should return style names from catalog when available', async () => {
      styleRepository.find.mockResolvedValueOnce([
        { id: 'st-1', name: JSON.stringify({ pt: 'Realismo' }) },
        { id: 'st-2', name: { pt: 'Blackwork' } },
        { id: 'st-3', name: 'Floral' },
        { id: 'st-4', name: '{ invalid json' },
      ] as any);
      await service.loadCatalog();

      const result = service.getStyleNames();
      expect(result).toEqual([
        'Realismo',
        'Blackwork',
        'Floral',
        '{ invalid json',
      ]);
    });

    it('should return fallback style names when catalog is empty', () => {
      const result = service.getStyleNames();
      expect(result).toContain('Blackwork');
      expect(result).toContain('Realismo');
    });
  });

  describe('getColorNames', () => {
    it('should return color names from catalog ignoring multicolor', async () => {
      tattooColorRepository.find.mockResolvedValueOnce([
        { id: 'col-1', color: JSON.stringify({ pt: 'Preto' }) },
        { id: 'col-2', color: { pt: 'Multicolorido' } },
        { id: 'col-3', color: 'Vermelho' },
        { id: 'col-4', color: '{ invalid json' },
      ] as any);
      await service.loadCatalog();

      const result = service.getColorNames();
      expect(result).toEqual(['Preto', 'Vermelho', '{ invalid json']);
    });

    it('should return fallback color names when catalog is empty', () => {
      const result = service.getColorNames();
      expect(result).toContain('Preto');
      expect(result).toContain('Vermelho');
    });
  });

  describe('resolveStyleId', () => {
    it('should resolve style ID by exact name or partial substring match', async () => {
      styleRepository.find.mockResolvedValueOnce([
        { id: 'st-1', name: 'Realismo' },
      ] as any);
      await service.loadCatalog();

      expect(service.resolveStyleId('Realismo')).toBe('st-1');
      expect(service.resolveStyleId('Realism')).toBe('st-1');
      expect(service.resolveStyleId('')).toBeNull();
      expect(service.resolveStyleId(null as any)).toBeNull();
    });
  });

  describe('resolveStyleIds', () => {
    it('should resolve multiple style names to array of unique IDs', async () => {
      styleRepository.find.mockResolvedValueOnce([
        { id: 'st-1', name: 'Realismo' },
        { id: 'st-2', name: 'Blackwork' },
      ] as any);
      await service.loadCatalog();

      const result = service.resolveStyleIds([
        'Realismo',
        'Blackwork',
        'Inexistente',
      ]);
      expect(result).toEqual(['st-1', 'st-2']);
      expect(service.resolveStyleIds(null as any)).toEqual([]);
    });
  });

  describe('getBlackGreyColorId', () => {
    it('should return black/grey color ID', async () => {
      tattooColorRepository.find.mockResolvedValueOnce([
        { id: 'col-black', color: 'Preto' },
      ] as any);
      await service.loadCatalog();

      expect(service.getBlackGreyColorId()).toBe('col-black');
    });
  });

  describe('getColorfulColorId', () => {
    it('should return colorful color ID', async () => {
      tattooColorRepository.find.mockResolvedValueOnce([
        { id: 'col-multi', color: 'Multicolorido' },
      ] as any);
      await service.loadCatalog();

      expect(service.getColorfulColorId()).toBe('col-multi');
    });
  });

  describe('resolveColorIdByName', () => {
    it('should resolve color ID by name', async () => {
      tattooColorRepository.find.mockResolvedValueOnce([
        { id: 'col-red', color: 'Vermelho' },
      ] as any);
      await service.loadCatalog();

      expect(service.resolveColorIdByName('vermelho')).toBe('col-red');
      expect(service.resolveColorIdByName('')).toBeNull();
      expect(service.resolveColorIdByName(null as any)).toBeNull();
    });
  });

  describe('resolveColorIds', () => {
    it('should resolve color IDs for colorful = true', async () => {
      tattooColorRepository.find.mockResolvedValueOnce([
        { id: 'col-multi', color: 'Multicolorido' },
        { id: 'col-red', color: 'Vermelho' },
      ] as any);
      await service.loadCatalog();

      const result = service.resolveColorIds(true, ['vermelho']);
      expect(result).toEqual(['col-multi', 'col-red']);
    });

    it('should resolve color IDs for colorful = false', async () => {
      tattooColorRepository.find.mockResolvedValueOnce([
        { id: 'col-black', color: 'Preto' },
        { id: 'col-grey', color: 'Cinza' },
      ] as any);
      await service.loadCatalog();

      const result = service.resolveColorIds(false, ['cinza']);
      expect(result).toEqual(['col-black', 'col-grey']);
    });

    it('should resolve detected colors when isColorful is null or undefined', async () => {
      tattooColorRepository.find.mockResolvedValueOnce([
        { id: 'col-blue', color: 'Azul' },
      ] as any);
      await service.loadCatalog();

      const result = service.resolveColorIds(null, ['azul']);
      expect(result).toEqual(['col-blue']);
    });
  });
});
