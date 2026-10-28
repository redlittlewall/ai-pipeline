import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AddHashtagService } from './AddHashtag.service';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { Client } from 'model/users/Client.entity';
import { HashTagService } from './HashTag.service';
import { AssociateHashtagUserService } from './AssociateHashtagUser.Service';
import { NotificationWorkflow } from 'modules/notification/NotificationWorkflow.Service';

describe('AddHashtagService', () => {
  let service: AddHashtagService;
  let tattooEntityRepository: any;
  let clientRepository: any;
  let hashtagService: any;
  let associateHashtagUser: any;
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
    tattooEntityRepository = createMockRepository();
    clientRepository = createMockRepository();
    hashtagService = {
      createOrRecoverTag: jest.fn(),
    };
    associateHashtagUser = {
      associateClient: jest.fn(),
      associateTattoo: jest.fn(),
    };
    notificationWorkflow = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddHashtagService,
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooEntityRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: HashTagService,
          useValue: hashtagService,
        },
        {
          provide: AssociateHashtagUserService,
          useValue: associateHashtagUser,
        },
        {
          provide: NotificationWorkflow,
          useValue: notificationWorkflow,
        },
      ],
    }).compile();

    service = module.get<AddHashtagService>(AddHashtagService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addTagsToProfile', () => {
    it('should add tags to profile successfully when given a list of hashtags', async () => {
      // Arrange
      const clientId = 'client-123';
      const hashtags = [{ name: 'tattoo' }, { name: 'ink' }] as any;
      hashtagService.createOrRecoverTag
        .mockResolvedValueOnce({ id: 'tag-1', name: 'tattoo' } as any)
        .mockResolvedValueOnce({ id: 'tag-2', name: 'ink' } as any);
      associateHashtagUser.associateClient.mockResolvedValue(true as any);

      // Act
      await service.addTagsToProfile(clientId, hashtags);

      // Assert
      expect(hashtagService.createOrRecoverTag).toHaveBeenCalledTimes(2);
      expect(hashtagService.createOrRecoverTag).toHaveBeenNthCalledWith(
        1,
        clientId,
        'tattoo',
      );
      expect(hashtagService.createOrRecoverTag).toHaveBeenNthCalledWith(
        2,
        clientId,
        'ink',
      );
      expect(associateHashtagUser.associateClient).toHaveBeenCalledTimes(2);
      expect(associateHashtagUser.associateClient).toHaveBeenNthCalledWith(
        1,
        'tag-1',
        clientId,
      );
      expect(associateHashtagUser.associateClient).toHaveBeenNthCalledWith(
        2,
        'tag-2',
        clientId,
      );
    });

    it('should handle empty hashtags array', async () => {
      // Act
      await service.addTagsToProfile('client-123', []);

      // Assert
      expect(hashtagService.createOrRecoverTag).not.toHaveBeenCalled();
      expect(associateHashtagUser.associateClient).not.toHaveBeenCalled();
    });
  });

  describe('sugestHashtag', () => {
    it('should return early if tattoo details are not found', async () => {
      // Arrange
      const clientId = 'client-1';
      const tattooId = 'tattoo-1';
      clientRepository.findOne.mockResolvedValueOnce({ id: clientId } as any);
      tattooEntityRepository.findOne.mockResolvedValueOnce({
        id: tattooId,
        owner: { id: clientId },
        details: null,
      } as any);
      hashtagService.createOrRecoverTag.mockResolvedValueOnce({
        id: 'tag-1',
        name: 'tag1',
      } as any);

      // Act
      await service.sugestHashtag(clientId, ['tag1'], tattooId);

      // Assert
      expect(associateHashtagUser.associateTattoo).not.toHaveBeenCalled();
      expect(notificationWorkflow.call).not.toHaveBeenCalled();
    });

    it('should suggest hashtag as tattoo owner and not trigger notifications', async () => {
      // Arrange
      const clientId = 'owner-id';
      const tattooId = 'tattoo-123';
      const client = { id: clientId, username: 'owner' };
      const tattoo = {
        id: tattooId,
        owner: { id: clientId },
        details: { detailsHasHashtags: [] },
      };

      clientRepository.findOne.mockResolvedValueOnce(client as any);
      tattooEntityRepository.findOne.mockResolvedValueOnce(tattoo as any);
      hashtagService.createOrRecoverTag.mockResolvedValueOnce({
        id: 'tag-1',
        name: 'art',
      } as any);
      associateHashtagUser.associateTattoo.mockResolvedValue(true as any);

      // Act
      await service.sugestHashtag(clientId, ['art'], tattooId);

      // Assert
      expect(hashtagService.createOrRecoverTag).toHaveBeenCalledWith(
        clientId,
        'art',
        true,
      );
      expect(associateHashtagUser.associateTattoo).toHaveBeenCalledWith(
        client,
        { id: 'tag-1', name: 'art' },
        tattoo,
        true,
        true,
      );
      expect(notificationWorkflow.call).not.toHaveBeenCalled();
    });

    it('should suggest hashtags as non-owner and send push notification to owner when new hashtags are suggested', async () => {
      // Arrange
      const clientId = 'suggester-id';
      const ownerId = 'owner-id';
      const tattooId = 'tattoo-123';
      const client = { id: clientId, username: 'suggesterUser' };
      const owner = { id: ownerId };
      const tattoo = {
        id: tattooId,
        owner,
        details: { detailsHasHashtags: [] },
      };

      clientRepository.findOne.mockResolvedValueOnce(client as any);
      tattooEntityRepository.findOne.mockResolvedValueOnce(tattoo as any);
      hashtagService.createOrRecoverTag.mockResolvedValueOnce({
        id: 'tag-1',
        name: 'blackwork',
      } as any);
      associateHashtagUser.associateTattoo.mockResolvedValue(true as any);

      // Act
      await service.sugestHashtag(clientId, ['blackwork'], tattooId);

      // Assert
      expect(hashtagService.createOrRecoverTag).toHaveBeenCalledWith(
        clientId,
        'blackwork',
        false,
      );
      expect(associateHashtagUser.associateTattoo).toHaveBeenCalledWith(
        client,
        { id: 'tag-1', name: 'blackwork' },
        tattoo,
        true,
        false,
      );
      expect(notificationWorkflow.call).toHaveBeenCalledWith(
        ownerId,
        expect.objectContaining({
          receiverClient: owner,
          senderClient: client,
          referencesTattoo: tattoo,
          appUrl: `/modal/tattoo/hashtag-approval/${tattooId}`,
        }),
        true,
      );
    });

    it('should fallback to default username "alguém" / "someone" in push notification if client username is missing', async () => {
      // Arrange
      const clientId = 'suggester-id';
      const ownerId = 'owner-id';
      const tattooId = 'tattoo-123';
      const client = { id: clientId, username: null };
      const owner = { id: ownerId };
      const tattoo = {
        id: tattooId,
        owner,
        details: { detailsHasHashtags: [] },
      };

      clientRepository.findOne.mockResolvedValueOnce(client as any);
      tattooEntityRepository.findOne.mockResolvedValueOnce(tattoo as any);
      hashtagService.createOrRecoverTag.mockResolvedValueOnce({
        id: 'tag-1',
        name: 'blackwork',
      } as any);

      // Act
      await service.sugestHashtag(clientId, ['blackwork'], tattooId);

      // Assert
      expect(notificationWorkflow.call).toHaveBeenCalledWith(
        ownerId,
        expect.objectContaining({
          message: {
            pt: 'O usuário alguém sugeriu 1 nova(s) hashtag(s) para sua tatuagem.',
            en: 'The user someone suggested 1 new hashtag(s) for your tattoo.',
          },
        }),
        true,
      );
    });

    it('should not send notification if non-owner suggests existing hashtags (0 new suggestions)', async () => {
      // Arrange
      const clientId = 'suggester-id';
      const tattooId = 'tattoo-123';
      const client = { id: clientId, username: 'suggesterUser' };
      const tattoo = {
        id: tattooId,
        owner: { id: 'owner-id' },
        details: {
          detailsHasHashtags: [{ hashtag: { id: 'tag-1' } }],
        },
      };

      clientRepository.findOne.mockResolvedValueOnce(client as any);
      tattooEntityRepository.findOne.mockResolvedValueOnce(tattoo as any);
      hashtagService.createOrRecoverTag.mockResolvedValueOnce({
        id: 'tag-1',
        name: 'existing',
      } as any);

      // Act
      await service.sugestHashtag(clientId, ['existing'], tattooId);

      // Assert
      expect(associateHashtagUser.associateTattoo).not.toHaveBeenCalled();
      expect(notificationWorkflow.call).not.toHaveBeenCalled();
    });
  });

  describe('_sugestHashtag', () => {
    it('should associate tattoo and return true if hashtag does not exist on tattoo details', async () => {
      // Arrange
      const client = { id: 'client-1' } as any;
      const tattoo = {
        details: {
          detailsHasHashtags: [{ hashtag: { id: 'other-tag' } }],
        },
      } as any;
      const hashtag = { id: 'new-tag' } as any;

      // Act
      const result = await service._sugestHashtag(
        client,
        tattoo,
        hashtag,
        true,
      );

      // Assert
      expect(result).toBe(true);
      expect(associateHashtagUser.associateTattoo).toHaveBeenCalledWith(
        client,
        hashtag,
        tattoo,
        true,
        true,
      );
    });

    it('should return false if hashtag already exists on tattoo details', async () => {
      // Arrange
      const client = { id: 'client-1' } as any;
      const tattoo = {
        details: {
          detailsHasHashtags: [{ hashtag: { id: 'existing-tag' } }],
        },
      } as any;
      const hashtag = { id: 'existing-tag' } as any;

      // Act
      const result = await service._sugestHashtag(
        client,
        tattoo,
        hashtag,
        false,
      );

      // Assert
      expect(result).toBe(false);
      expect(associateHashtagUser.associateTattoo).not.toHaveBeenCalled();
    });

    it('should return true when detailsHasHashtags is undefined or null', async () => {
      // Arrange
      const client = { id: 'client-1' } as any;
      const tattoo = { details: {} } as any;
      const hashtag = { id: 'new-tag' } as any;

      // Act
      const result = await service._sugestHashtag(
        client,
        tattoo,
        hashtag,
        false,
      );

      // Assert
      expect(result).toBe(true);
      expect(associateHashtagUser.associateTattoo).toHaveBeenCalledWith(
        client,
        hashtag,
        tattoo,
        true,
        false,
      );
    });
  });
});
