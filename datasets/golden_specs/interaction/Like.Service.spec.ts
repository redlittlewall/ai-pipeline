import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LikeService } from './Like.Service';
import { Client } from 'model/users/Client.entity';
import { Artist } from 'model/users/Artist.entity';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { ClientInteractTattoo } from 'model/users/relations/ClientInteractTattoo.entity';
import { ClientInteractArtist } from 'model/users/relations/ClientInteractArtist.entity';
import { AssociateHashtagUserService } from 'modules/hashtags/AssociateHashtagUser.Service';
import { NotificationWorkflow } from 'modules/notification/NotificationWorkflow.Service';
import { UserNotFoundException } from 'exceptions/UserNotFoundException';
import { ClientInteractionEnum } from 'enums/ClientInteractionEnum';

describe('LikeService', () => {
  let service: LikeService;
  let clientRepository: any;
  let artistRepository: any;
  let tattooEntityRepository: any;
  let clientInteractTattooRepository: any;
  let clientInteractArtistRepository: any;
  let associateHashtagUserService: any;
  let notificationWorkflow: any;

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
    clientRepository = createMockRepository();
    artistRepository = createMockRepository();
    tattooEntityRepository = createMockRepository();
    clientInteractTattooRepository = createMockRepository();
    clientInteractArtistRepository = createMockRepository();
    associateHashtagUserService = {
      associateClient: jest.fn(),
    };
    notificationWorkflow = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LikeService,
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooEntityRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractTattoo),
          useValue: clientInteractTattooRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractArtist),
          useValue: clientInteractArtistRepository,
        },
        {
          provide: AssociateHashtagUserService,
          useValue: associateHashtagUserService,
        },
        {
          provide: NotificationWorkflow,
          useValue: notificationWorkflow,
        },
      ],
    }).compile();

    service = module.get<LikeService>(LikeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('likeTattoo', () => {
    it('should throw UserNotFoundException when client does not exist', async () => {
      clientRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.likeTattoo('u1', 't1')).rejects.toThrow(
        UserNotFoundException,
      );
    });

    it('should throw UserNotFoundException when tattoo does not exist', async () => {
      clientRepository.findOne.mockResolvedValueOnce({ id: 'u1' } as any);
      tattooEntityRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.likeTattoo('u1', 't1')).rejects.toThrow(
        UserNotFoundException,
      );
    });

    it('should restore soft-deleted like if it already existed', async () => {
      clientRepository.findOne.mockResolvedValueOnce({ id: 'u1' } as any);
      tattooEntityRepository.findOne.mockResolvedValueOnce({ id: 't1' } as any);
      clientInteractTattooRepository.findOne.mockResolvedValueOnce({
        id: 'rel1',
        deletedAt: new Date(),
      } as any);

      const result = await service.likeTattoo('u1', 't1');

      expect(result).toBe(true);
      expect(clientInteractTattooRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'rel1', deletedAt: null }),
      );
    });

    it('should soft-delete like if it already exists and is active', async () => {
      clientRepository.findOne.mockResolvedValueOnce({ id: 'u1' } as any);
      tattooEntityRepository.findOne.mockResolvedValueOnce({ id: 't1' } as any);
      clientInteractTattooRepository.findOne.mockResolvedValueOnce({
        id: 'rel1',
        deletedAt: null,
      } as any);

      const result = await service.likeTattoo('u1', 't1');

      expect(result).toBe(false);
      expect(clientInteractTattooRepository.softDelete).toHaveBeenCalledWith(
        'rel1',
      );
    });

    it('should create new like and send notification when first liked by another user', async () => {
      const client = { id: 'u1', username: 'user1' };
      const tattoo = { id: 't1', artist: { id: 'a1', client: { id: 'ac1' } } };
      clientRepository.findOne.mockResolvedValueOnce(client as any);
      tattooEntityRepository.findOne.mockResolvedValueOnce(tattoo as any);
      clientInteractTattooRepository.findOne.mockResolvedValueOnce(null);

      const result = await service.likeTattoo('u1', 't1');

      expect(result).toBe(true);
      expect(notificationWorkflow.call).toHaveBeenCalled();
      expect(clientInteractTattooRepository.save).toHaveBeenCalled();
    });

    it('should create new like without notification if user likes their own tattoo', async () => {
      const client = { id: 'a1', username: 'artistUser' };
      const tattoo = { id: 't1', artist: { id: 'a1', client: { id: 'a1' } } };
      clientRepository.findOne.mockResolvedValueOnce(client as any);
      tattooEntityRepository.findOne.mockResolvedValueOnce(tattoo as any);
      clientInteractTattooRepository.findOne.mockResolvedValueOnce(null);

      await service.likeTattoo('a1', 't1');

      expect(notificationWorkflow.call).not.toHaveBeenCalled();
      expect(clientInteractTattooRepository.save).toHaveBeenCalled();
    });
  });

  describe('likeArtist', () => {
    it('should throw UserNotFoundException when client does not exist', async () => {
      clientRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.likeArtist('u1', 'a1')).rejects.toThrow(
        UserNotFoundException,
      );
    });

    it('should throw UserNotFoundException when artist does not exist', async () => {
      clientRepository.findOne.mockResolvedValueOnce({ id: 'u1' } as any);
      artistRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.likeArtist('u1', 'a1')).rejects.toThrow(
        UserNotFoundException,
      );
    });

    it('should restore soft-deleted artist like', async () => {
      clientRepository.findOne.mockResolvedValueOnce({ id: 'u1' } as any);
      artistRepository.findOne.mockResolvedValueOnce({ id: 'a1' } as any);
      clientInteractArtistRepository.findOne.mockResolvedValueOnce({
        id: 'rel1',
        deletedAt: new Date(),
      } as any);

      const result = await service.likeArtist('u1', 'a1');

      expect(result).toBe(true);
      expect(clientInteractArtistRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: null }),
      );
    });

    it('should soft-delete active artist like', async () => {
      clientRepository.findOne.mockResolvedValueOnce({ id: 'u1' } as any);
      artistRepository.findOne.mockResolvedValueOnce({ id: 'a1' } as any);
      clientInteractArtistRepository.findOne.mockResolvedValueOnce({
        id: 'rel1',
        deletedAt: null,
      } as any);

      const result = await service.likeArtist('u1', 'a1');

      expect(result).toBe(false);
      expect(clientInteractArtistRepository.softDelete).toHaveBeenCalledWith(
        'rel1',
      );
    });

    it('should create new artist like and notify', async () => {
      const client = { id: 'u1', username: 'user1' };
      const artist = { id: 'a1', client: { id: 'ac1' } };
      clientRepository.findOne.mockResolvedValueOnce(client as any);
      artistRepository.findOne.mockResolvedValueOnce(artist as any);
      clientInteractArtistRepository.findOne.mockResolvedValueOnce(null);

      const result = await service.likeArtist('u1', 'a1');

      expect(result).toBe(true);
      expect(notificationWorkflow.call).toHaveBeenCalled();
      expect(clientInteractArtistRepository.save).toHaveBeenCalled();
    });
  });

  describe('likeHashtag', () => {
    it('should call associateHashtagUserService for hashtag liking', async () => {
      clientRepository.findOne.mockResolvedValueOnce({ id: 'u1' } as any);
      associateHashtagUserService.associateClient.mockResolvedValueOnce(true);

      const result = await service.likeHashtag('u1', 'h1');

      expect(result).toBe(true);
      expect(associateHashtagUserService.associateClient).toHaveBeenCalledWith(
        'h1',
        'u1',
      );
    });
  });
});
