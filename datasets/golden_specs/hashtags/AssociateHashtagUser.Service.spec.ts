import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AssociateHashtagUserService } from './AssociateHashtagUser.Service';
import { Hashtag } from 'model/hashtag/Hashtag.entity';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { Client } from 'model/users/Client.entity';
import { TattooDetailsHasHashtag } from 'model/hashtag/TattooHasHashtag.entity';
import { ClientInteractHashtag } from 'model/hashtag/ClientInteractHashtag.entity';
import { ApprovalStatus } from 'enums/ApprovalStatus';
import { ClientInteractionEnum } from 'enums/ClientInteractionEnum';

describe('AssociateHashtagUserService', () => {
  let service: AssociateHashtagUserService;
  let hashTagRepository: any;
  let tattooEntityRepository: any;
  let clientRepository: any;
  let tattooHasHashtagRepository: any;
  let clientInteractHashtagRepository: any;

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
        update: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
    };

    hashTagRepository = createMockRepository();
    tattooEntityRepository = createMockRepository();
    clientRepository = createMockRepository();
    tattooHasHashtagRepository = createMockRepository();
    clientInteractHashtagRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssociateHashtagUserService,
        {
          provide: getRepositoryToken(Hashtag),
          useValue: hashTagRepository,
        },
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooEntityRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(TattooDetailsHasHashtag),
          useValue: tattooHasHashtagRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractHashtag),
          useValue: clientInteractHashtagRepository,
        },
      ],
    }).compile();

    service = module.get<AssociateHashtagUserService>(
      AssociateHashtagUserService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('associateClient', () => {
    it('should throw NotFoundException if hashtag does not exist', async () => {
      clientInteractHashtagRepository.findOne.mockResolvedValueOnce(null);
      hashTagRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.associateClient('hashtag-1', 'client-1'),
      ).rejects.toThrow(NotFoundException);
      expect(clientInteractHashtagRepository.save).not.toHaveBeenCalled();
    });

    it('should propagate errors when repository rejects (Sad Path)', async () => {
      clientInteractHashtagRepository.findOne.mockRejectedValueOnce(
        new Error('Database error'),
      );

      await expect(
        service.associateClient('hashtag-1', 'client-1'),
      ).rejects.toThrow('Database error');
    });

    it('should save new interaction and return true when relation does not exist', async () => {
      const mockHashtag = { id: 'hashtag-1', name: 'tattoo' } as any;

      clientInteractHashtagRepository.findOne.mockResolvedValueOnce(null);
      hashTagRepository.findOne.mockResolvedValueOnce(mockHashtag);

      const result = await service.associateClient('hashtag-1', 'client-1');

      expect(result).toBe(true);
      expect(clientInteractHashtagRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          interactionType: ClientInteractionEnum.LIKE,
          client: 'client-1',
          hashtag: mockHashtag,
        }),
      );
    });

    it('should delete existing interaction and return false when relation exists', async () => {
      const mockHashtag = { id: 'hashtag-1', name: 'tattoo' } as any;
      const mockRelation = { id: 'relation-1' } as any;

      const qb = clientInteractHashtagRepository.createQueryBuilder();
      qb.from.mockImplementation(() => qb);

      clientInteractHashtagRepository.findOne.mockResolvedValueOnce(
        mockRelation,
      );
      hashTagRepository.findOne.mockResolvedValueOnce(mockHashtag);

      const result = await service.associateClient('hashtag-1', 'client-1');

      expect(result).toBe(false);
      expect(qb.delete).toHaveBeenCalled();
      expect(qb.from).toHaveBeenCalledWith(ClientInteractHashtag);
      expect(qb.where).toHaveBeenCalledWith('id = :id', {
        id: mockRelation.id,
      });
      expect(qb.execute).toHaveBeenCalled();
    });
  });

  describe('associateTattoo', () => {
    it('should do nothing if relation already exists', async () => {
      const mockClient = { id: 'client-1' } as any;
      const mockTag = { id: 'tag-1' } as any;
      const mockTattoo = {
        id: 'tattoo-1',
        owner: { id: 'client-1' },
        details: {},
      } as any;
      const mockOldRelation = { id: 'old-1' } as any;

      tattooHasHashtagRepository.findOne.mockResolvedValueOnce(mockOldRelation);

      await service.associateTattoo(
        mockClient,
        mockTag,
        mockTattoo,
        false,
        true,
      );

      expect(tattooHasHashtagRepository.save).not.toHaveBeenCalled();
    });

    it('should save tattoo hashtag association with APPROVED status when isOwner is true and isTattooOwner is true', async () => {
      const mockClient = { id: 'client-1' } as any;
      const mockTag = { id: 'tag-1' } as any;
      const mockDetails = { id: 'details-1' } as any;
      const mockTattoo = {
        id: 'tattoo-1',
        owner: { id: 'client-1' },
        details: mockDetails,
      } as any;

      tattooHasHashtagRepository.findOne.mockResolvedValueOnce(null);

      await service.associateTattoo(
        mockClient,
        mockTag,
        mockTattoo,
        false,
        true,
      );

      expect(tattooHasHashtagRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ApprovalStatus.APPROVED,
          isSuggested: false,
          approvedBy: mockClient,
        }),
      );
    });

    it('should save tattoo hashtag association with PENDING status when isOwner is false and isTattooOwner is false', async () => {
      const mockClient = { id: 'client-1' } as any;
      const mockTag = { id: 'tag-1' } as any;
      const mockDetails = { id: 'details-1' } as any;
      const mockTattoo = {
        id: 'tattoo-1',
        owner: { id: 'client-2' },
        details: mockDetails,
      } as any;

      tattooHasHashtagRepository.findOne.mockResolvedValueOnce(null);

      await service.associateTattoo(
        mockClient,
        mockTag,
        mockTattoo,
        true,
        false,
      );

      expect(tattooHasHashtagRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ApprovalStatus.PENDING,
          isSuggested: true,
          approvedBy: null,
          approvedAt: null,
        }),
      );
    });

    it('should handle default isSuggested parameter when not provided', async () => {
      const mockClient = { id: 'client-1' } as any;
      const mockTag = { id: 'tag-1' } as any;
      const mockDetails = { id: 'details-1' } as any;
      const mockTattoo = {
        id: 'tattoo-1',
        owner: { id: 'client-2' },
        details: mockDetails,
      } as any;

      tattooHasHashtagRepository.findOne.mockResolvedValueOnce(null);

      await service.associateTattoo(
        mockClient,
        mockTag,
        mockTattoo,
        undefined,
        false,
      );

      expect(tattooHasHashtagRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ApprovalStatus.PENDING,
          isSuggested: false,
        }),
      );
    });

    it('should propagate errors when repository rejects in associateTattoo (Sad Path)', async () => {
      const mockClient = { id: 'client-1' } as any;
      const mockTag = { id: 'tag-1' } as any;
      const mockTattoo = {
        id: 'tattoo-1',
        owner: { id: 'client-1' },
        details: {},
      } as any;

      tattooHasHashtagRepository.findOne.mockRejectedValueOnce(
        new Error('Database failure'),
      );

      await expect(
        service.associateTattoo(mockClient, mockTag, mockTattoo, false, true),
      ).rejects.toThrow('Database failure');
    });
  });
});
