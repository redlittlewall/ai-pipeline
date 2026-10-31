import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UpdatePhoneService } from './UpdatePhone.service';
import { Artist } from 'model/users/Artist.entity';
import { Client } from 'model/users/Client.entity';

describe('UpdatePhoneService', () => {
  let service: UpdatePhoneService;
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
        UpdatePhoneService,
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

    service = module.get<UpdatePhoneService>(UpdatePhoneService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('update', () => {
    it('should update artist and client phone successfully when artist exists', async () => {
      const artistId = 'artist-123';
      const phone = '+1234567890';
      const phoneTermsAcepted = true;
      const whatsappPhone = true;

      const mockArtist = {
        id: artistId,
        phone: 'old-phone',
        phoneTermsAcepted: false,
        whatsappPhone: false,
      } as any;

      artistRepository.findOne.mockResolvedValueOnce(mockArtist);

      await service.update(artistId, phone, phoneTermsAcepted, whatsappPhone);

      expect(artistRepository.findOne).toHaveBeenCalledWith({
        where: { id: artistId },
      });
      expect(mockArtist.phone).toBe(phone);
      expect(mockArtist.phoneTermsAcepted).toBe(phoneTermsAcepted);
      expect(mockArtist.whatsappPhone).toBe(whatsappPhone);
      expect(artistRepository.save).toHaveBeenCalledWith(mockArtist);
      expect(clientRepository.update).toHaveBeenCalledWith(
        { id: artistId },
        { phone: phone },
      );
    });

    it('should throw an error when artist is not found', async () => {
      const artistId = 'non-existent-artist';
      artistRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.update(artistId, '+1234567890', true, false),
      ).rejects.toThrow('Artist not found');

      expect(artistRepository.findOne).toHaveBeenCalledWith({
        where: { id: artistId },
      });
      expect(artistRepository.save).not.toHaveBeenCalled();
      expect(clientRepository.update).not.toHaveBeenCalled();
    });

    it('should propagate errors if artistRepository save fails', async () => {
      const artistId = 'artist-123';
      const mockArtist = { id: artistId } as any;

      artistRepository.findOne.mockResolvedValueOnce(mockArtist);
      artistRepository.save.mockRejectedValueOnce(new Error('Database error'));

      await expect(
        service.update(artistId, '+1234567890', true, true),
      ).rejects.toThrow('Database error');
    });
  });
});
