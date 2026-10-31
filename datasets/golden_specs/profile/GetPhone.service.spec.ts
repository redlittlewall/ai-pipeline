import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetPhoneService } from './GetPhone.service';
import { Artist } from 'model/users/Artist.entity';
import { Client } from 'model/users/Client.entity';

describe('GetPhoneService', () => {
  let service: GetPhoneService;
  let artistRepository: any;
  let clientRepository: any;

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
    artistRepository = createMockRepository();
    clientRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetPhoneService,
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
      ],
    }).compile();

    service = module.get<GetPhoneService>(GetPhoneService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('should execute get successfully when artist is found with artist phone', async () => {
      // Given
      const mockArtist = {
        id: 'artist-1',
        phone: '123456789',
        phoneTermsAcepted: true,
        whatsappPhone: true,
        client: null,
      };
      artistRepository.findOne.mockResolvedValueOnce(mockArtist as any);

      // When
      const result = await service.get('artist-1');

      // Then
      expect(artistRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'artist-1' },
        relations: ['client'],
      });
      expect(result).toBeDefined();
      expect(result.phone).toBe('123456789');
      expect(result.phoneTermsAcepted).toBe(true);
      expect(result.whatsappPhone).toBe(true);
    });

    it('should fallback to client phone when artist phone is empty but artist has client relation', async () => {
      // Given
      const mockArtist = {
        id: 'artist-1',
        phone: '',
        phoneTermsAcepted: true,
        whatsappPhone: false,
        client: {
          phone: '987654321',
        },
      };
      artistRepository.findOne.mockResolvedValueOnce(mockArtist as any);

      // When
      const result = await service.get('artist-1');

      // Then
      expect(result).toBeDefined();
      expect(result.phone).toBe('987654321');
      expect(result.phoneTermsAcepted).toBe(true);
      expect(result.whatsappPhone).toBe(false);
    });

    it('should return empty phone string when artist is found but has no phone and no client phone', async () => {
      // Given
      const mockArtist = {
        id: 'artist-1',
        phone: null,
        phoneTermsAcepted: false,
        whatsappPhone: false,
        client: null,
      };
      artistRepository.findOne.mockResolvedValueOnce(mockArtist as any);

      // When
      const result = await service.get('artist-1');

      // Then
      expect(result).toBeDefined();
      expect(result.phone).toBe('');
      expect(result.phoneTermsAcepted).toBe(false);
      expect(result.whatsappPhone).toBe(false);
    });

    it('should query client repository and return client phone when artist is not found', async () => {
      // Given
      artistRepository.findOne.mockResolvedValueOnce(null);
      clientRepository.findOne.mockResolvedValueOnce({
        id: 'artist-1',
        phone: '5551234',
      } as any);

      // When
      const result = await service.get('artist-1');

      // Then
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'artist-1' },
        select: ['id', 'phone'],
      });
      expect(result).toBeDefined();
      expect(result.phone).toBe('5551234');
      expect(result.phoneTermsAcepted).toBe(false);
      expect(result.whatsappPhone).toBe(false);
    });

    it('should return empty phone and default flags when neither artist nor client is found', async () => {
      // Given
      artistRepository.findOne.mockResolvedValueOnce(null);
      clientRepository.findOne.mockResolvedValueOnce(null);

      // When
      const result = await service.get('invalid-id');

      // Then
      expect(result).toBeDefined();
      expect(result.phone).toBe('');
      expect(result.phoneTermsAcepted).toBe(false);
      expect(result.whatsappPhone).toBe(false);
    });

    it('should propagate errors when artistRepository throws an error', async () => {
      // Given
      artistRepository.findOne.mockRejectedValueOnce(
        new Error('Database error'),
      );

      // When & Then
      await expect(service.get('artist-1')).rejects.toThrow('Database error');
    });

    it('should propagate errors when clientRepository throws an error', async () => {
      // Given
      artistRepository.findOne.mockResolvedValueOnce(null);
      clientRepository.findOne.mockRejectedValueOnce(
        new Error('Database client error'),
      );

      // When & Then
      await expect(service.get('artist-1')).rejects.toThrow(
        'Database client error',
      );
    });
  });
});
