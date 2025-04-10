import { inject, Injectable } from '@angular/core';
import { AllowedDBKeys, DB } from './storage-keys.const';
import { GlobalConfigState } from '../../features/config/global-config.model';
import {
  ArchiveTask,
  Task,
  TaskArchive,
  TaskState,
} from '../../features/tasks/task.model';
import { AppBaseData, AppDataComplete } from '../../imex/sync/sync.model';
import { Reminder } from '../../features/reminder/reminder.model';
import { DatabaseService } from './database.service';
import { Project, ProjectState } from '../../features/project/project.model';
import {
  PersistenceBaseEntityModel,
  PersistenceBaseModel,
  PersistenceBaseModelCfg,
  PersistenceEntityModelCfg,
} from './persistence.model';
import { Metric, MetricState } from '../../features/metric/metric.model';
import {
  Improvement,
  ImprovementState,
} from '../../features/metric/improvement/improvement.model';
import {
  Obstruction,
  ObstructionState,
} from '../../features/metric/obstruction/obstruction.model';
import {
  TaskRepeatCfg,
  TaskRepeatCfgState,
} from '../../features/task-repeat-cfg/task-repeat-cfg.model';
import { Note, NoteState } from '../../features/note/note.model';
import { Action, Store } from '@ngrx/store';
import { Tag, TagState } from '../../features/tag/tag.model';
import { checkFixEntityStateConsistency } from '../../util/check-fix-entity-state-consistency';
import {
  SimpleCounter,
  SimpleCounterState,
} from '../../features/simple-counter/simple-counter.model';
import { Subject } from 'rxjs';
import { devError } from '../../util/dev-error';
import { removeFromDb, saveToDb } from './persistence.actions';
import { crossModelMigrations } from './cross-model-migrations';
import { DEFAULT_APP_BASE_DATA } from '../../imex/sync/sync.const';
import { isValidAppData } from '../../imex/sync/is-valid-app-data.util';
import { BASE_MODEL_CFGS, ENTITY_MODEL_CFGS } from './persistence.const';
import { PersistenceLocalService } from './persistence-local.service';
import { PlannerState } from '../../features/planner/store/planner.reducer';
import { IssueProvider, IssueProviderState } from '../../features/issue/issue.model';
import { BoardsState } from '../../features/boards/store/boards.reducer';

const MAX_INVALID_DATA_ATTEMPTS = 10;

@Injectable({
  providedIn: 'root',
})
export class PersistenceService {
  private _databaseService = inject(DatabaseService);
  private _persistenceLocalService = inject(PersistenceLocalService);
  private _store = inject<Store<any>>(Store);

  // handled as private but needs to be assigned before the creations
  _baseModels: PersistenceBaseModel<unknown>[] = [];

  // TODO auto generate ls keys from appDataKey where possible
  globalConfig: PersistenceBaseModel<GlobalConfigState> = this._cmBase<GlobalConfigState>(
    BASE_MODEL_CFGS.globalConfig,
  );
  reminders: PersistenceBaseModel<Reminder[]> = this._cmBase<Reminder[]>(
    BASE_MODEL_CFGS.reminders,
  );
  planner: PersistenceBaseModel<PlannerState> = this._cmBase<PlannerState>(
    BASE_MODEL_CFGS.planner,
  );
  boards: PersistenceBaseModel<BoardsState> = this._cmBase<BoardsState>(
    BASE_MODEL_CFGS.boards,
  );

  project: PersistenceBaseEntityModel<ProjectState, Project> = this._cmBaseEntity<
    ProjectState,
    Project
  >(ENTITY_MODEL_CFGS.project);

  issueProvider: PersistenceBaseEntityModel<IssueProviderState, IssueProvider> =
    this._cmBaseEntity<IssueProviderState, IssueProvider>(
      ENTITY_MODEL_CFGS.issueProvider,
    );

  tag: PersistenceBaseEntityModel<TagState, Tag> = this._cmBaseEntity<TagState, Tag>(
    ENTITY_MODEL_CFGS.tag,
  );
  simpleCounter: PersistenceBaseEntityModel<SimpleCounterState, SimpleCounter> =
    this._cmBaseEntity<SimpleCounterState, SimpleCounter>(
      ENTITY_MODEL_CFGS.simpleCounter,
    );
  note: PersistenceBaseEntityModel<NoteState, Note> = this._cmBaseEntity<NoteState, Note>(
    ENTITY_MODEL_CFGS.note,
  );

  // METRIC MODELS
  metric: PersistenceBaseEntityModel<MetricState, Metric> = this._cmBaseEntity<
    MetricState,
    Metric
  >(ENTITY_MODEL_CFGS.metric);

  improvement: PersistenceBaseEntityModel<ImprovementState, Improvement> =
    this._cmBaseEntity<ImprovementState, Improvement>(ENTITY_MODEL_CFGS.improvement);
  obstruction: PersistenceBaseEntityModel<ObstructionState, Obstruction> =
    this._cmBaseEntity<ObstructionState, Obstruction>(ENTITY_MODEL_CFGS.obstruction);

  // MAIN TASK MODELS
  task: PersistenceBaseEntityModel<TaskState, Task> = this._cmBaseEntity<TaskState, Task>(
    ENTITY_MODEL_CFGS.task,
  );
  taskArchive: PersistenceBaseEntityModel<TaskArchive, ArchiveTask> = this._cmBaseEntity<
    TaskArchive,
    ArchiveTask
  >(ENTITY_MODEL_CFGS.taskArchive);
  taskRepeatCfg: PersistenceBaseEntityModel<TaskRepeatCfgState, TaskRepeatCfg> =
    this._cmBaseEntity<TaskRepeatCfgState, TaskRepeatCfg>(
      ENTITY_MODEL_CFGS.taskRepeatCfg,
    );

  onAfterSave$: Subject<{
    appDataKey: AllowedDBKeys;
    data: unknown;
    isDataImport: boolean;
    isSyncModelChange: boolean;
    projectId?: string;
  }> = new Subject();

  private _isBlockSaving: boolean = false;
  private _invalidDataCount = 0;

  async getValidCompleteData(): Promise<AppDataComplete> {
    const d = await this.loadComplete();
    // if we are very unlucky (e.g. a task has updated but not the related tag changes) app data might not be valid. we never want to sync that! :)
    if (isValidAppData(d)) {
      this._invalidDataCount = 0;
      return d;
    } else {
      // TODO remove as this is not a real error, and this is just a test to check if this ever occurs
      devError('Invalid data => RETRY getValidCompleteData');
      this._invalidDataCount++;
      if (this._invalidDataCount > MAX_INVALID_DATA_ATTEMPTS) {
        throw new Error('Unable to get valid app data');
      }
      return this.getValidCompleteData();
    }
  }

  // BACKUP AND SYNC RELATED
  // -----------------------
  async loadBackup(): Promise<AppDataComplete> {
    return this._loadFromDb({ dbKey: DB.BACKUP });
  }

  async saveBackup(backup?: AppDataComplete): Promise<unknown> {
    const data: AppDataComplete = backup || (await this.loadComplete());
    return this._saveToDb({
      dbKey: DB.BACKUP,
      data,
      isDataImport: true,
      isSyncModelChange: true,
    });
  }

  async clearBackup(): Promise<unknown> {
    return this._removeFromDb({ dbKey: DB.BACKUP });
  }

  // NOTE: not including backup
  // async loadCompleteWithPrivate(): Promise<AppDataComplete> {
  // }

  async loadComplete(isMigrate = false): Promise<AppDataComplete> {
    const projectState = await this.project.loadState();
    const pids = projectState ? (projectState.ids as string[]) : [];
    if (!pids) {
      throw new Error('Project State is broken');
    }

    const r = isMigrate
      ? crossModelMigrations({
          ...(await this._loadAppBaseData()),
        } as AppDataComplete)
      : {
          ...(await this._loadAppBaseData()),
        };

    return {
      ...r,
      lastLocalSyncModelChange:
        await this._persistenceLocalService.loadLastSyncModelChange(),
      lastArchiveUpdate: await this._persistenceLocalService.loadLastArchiveChange(),
    };
  }

  async importComplete(data: AppDataComplete): Promise<unknown> {
    console.log('IMPORT--->', data);
    this._isBlockSaving = true;

    const forBase = Promise.all(
      this._baseModels.map(async (modelCfg: PersistenceBaseModel<any>) => {
        return await modelCfg.saveState(data[modelCfg.appDataKey], {
          isDataImport: true,
        });
      }),
    );

    return await Promise.all([forBase])
      .then(() => {
        if (typeof data.lastLocalSyncModelChange !== 'number') {
          // not necessarily a critical error as there might be other reasons for this error to popup
          devError('No lastLocalSyncModelChange for imported data');
          data.lastLocalSyncModelChange = Date.now();
        }

        return Promise.all([
          this._persistenceLocalService.updateLastSyncModelChange(
            data.lastLocalSyncModelChange,
          ),
          this._persistenceLocalService.updateLastArchiveChange(
            data.lastArchiveUpdate || 0,
          ),
        ]);
      })
      .finally(() => {
        this._isBlockSaving = false;
      });
  }

  async clearDatabaseExceptBackupAndLocalOnlyModel(): Promise<void> {
    const backup: AppDataComplete = await this.loadBackup();
    const localOnlyModel = await this._persistenceLocalService.load();
    await this._databaseService.clearDatabase();
    await this._persistenceLocalService.save(localOnlyModel);
    if (backup) {
      await this.saveBackup(backup);
    }
  }

  async _loadAppBaseData(): Promise<AppBaseData> {
    const promises = this._baseModels.map(async (modelCfg) => {
      const modelState = await modelCfg.loadState();
      return {
        [modelCfg.appDataKey]: modelState || DEFAULT_APP_BASE_DATA[modelCfg.appDataKey],
      };
    });
    const baseDataArray: Partial<AppBaseData>[] = await Promise.all(promises);
    return Object.assign({}, ...baseDataArray);
  }

  // TODO maybe refactor to class?

  // ------------------
  private _cmBase<T extends Record<string, any>>({
    appDataKey,
    migrateFn = (v) => v,
    // NOTE: isSkipPush is used to use this for _cmBaseEntity as well
    isSkipPush = false,
  }: PersistenceBaseModelCfg<T>): PersistenceBaseModel<T> {
    const model = {
      appDataKey,
      loadState: async (isSkipMigrate = false) => {
        const modelData = await this._loadFromDb({
          dbKey: appDataKey,
        });
        return modelData
          ? isSkipMigrate
            ? modelData
            : migrateFn(modelData)
          : // we want to be sure there is always a valid value returned
            DEFAULT_APP_BASE_DATA[appDataKey];
      },
      // In case we want to check on load
      // loadState: async (isSkipMigrate = false) => {
      //   const data = isSkipMigrate
      //     ? await this._loadFromDb(lsKey)
      //     : await this._loadFromDb(lsKey).then(migrateFn);
      //   if (data && data.ids && data.entities) {
      //     checkFixEntityStateConsistency(data, appDataKey);
      //   }
      //   return data;
      // },
      saveState: (
        data: T,
        {
          isDataImport = false,
          isSyncModelChange,
        }: { isDataImport?: boolean; isSyncModelChange: boolean },
      ) => {
        if (data && data.ids && data.entities) {
          data = checkFixEntityStateConsistency(data, appDataKey);
        }
        return this._saveToDb({
          dbKey: appDataKey,
          data,
          isDataImport,
          isSyncModelChange,
        });
      },
    };
    if (!isSkipPush) {
      this._baseModels.push(model);
    }
    return model;
  }

  private _cmBaseEntity<S extends Record<string, any>, M>({
    appDataKey,
    modelVersion,
    reducerFn,
    migrateFn = (v) => v,
  }: PersistenceEntityModelCfg<S, M>): PersistenceBaseEntityModel<S, M> {
    const model = {
      // NOTE: isSkipPush is true because we do it below after
      ...this._cmBase({
        appDataKey,
        modelVersion,
        migrateFn,
        isSkipPush: true,
      }),

      getById: async (id: string): Promise<M> => {
        const state = (await model.loadState()) as any;
        return (state && state.entities && state.entities[id]) || null;
      },

      // NOTE: side effects are not executed!!!
      execAction: async (action: Action, isSyncModelChange = false): Promise<S> => {
        const state: S = await model.loadState();
        const newState: S = reducerFn(state, action);
        await model.saveState(newState, { isDataImport: false, isSyncModelChange });
        return newState;
      },

      // NOTE: side effects are not executed!!!
      execActions: async (actions: Action[], isSyncModelChange = false): Promise<S> => {
        const state: S = await model.loadState();
        const newState: S = actions.reduce((acc, act) => reducerFn(acc, act), state);
        await model.saveState(newState, { isDataImport: false, isSyncModelChange });
        return newState;
      },
    };

    this._baseModels.push(model);
    return model;
  }

  // DATA STORAGE INTERFACE
  // ---------------------
  private _getIDBKey(dbKey: AllowedDBKeys, projectId?: string): string {
    return projectId ? 'p__' + projectId + '__' + dbKey : dbKey;
  }

  private async _saveToDb({
    dbKey,
    data,
    isDataImport = false,
    projectId,
    isSyncModelChange = false,
  }: {
    dbKey: AllowedDBKeys;
    data: Record<string, any>;
    projectId?: string;
    isDataImport?: boolean;
    isSyncModelChange?: boolean;
  }): Promise<any> {
    if (!this._isBlockSaving || isDataImport === true) {
      const idbKey = this._getIDBKey(dbKey, projectId);
      this._store.dispatch(saveToDb({ dbKey, data }));
      const r = await this._databaseService.save(idbKey, data);
      const now = Date.now();

      if (isSyncModelChange) {
        await this._persistenceLocalService.updateLastSyncModelChange(now);
      }
      if (dbKey === 'taskArchive' || dbKey === 'archivedProjects') {
        await this._persistenceLocalService.updateLastArchiveChange(now);
      }

      this.onAfterSave$.next({
        appDataKey: dbKey,
        data,
        isDataImport,
        projectId,
        isSyncModelChange,
      });

      return r;
    } else {
      console.warn('BLOCKED SAVING for ', dbKey);
      return Promise.reject('Data import currently in progress. Saving disabled');
    }
  }

  private async _removeFromDb({
    dbKey,
    isDataImport = false,
    projectId,
  }: {
    dbKey: AllowedDBKeys;
    projectId?: string;
    isDataImport?: boolean;
  }): Promise<any> {
    const idbKey = this._getIDBKey(dbKey, projectId);
    if (!this._isBlockSaving || isDataImport === true) {
      this._store.dispatch(removeFromDb({ dbKey }));
      return this._databaseService.remove(idbKey);
    } else {
      console.warn('BLOCKED SAVING for ', dbKey);
      return Promise.reject('Data import currently in progress. Removing disabled');
    }
  }

  private async _loadFromDb({
    dbKey,
    projectId,
  }: {
    dbKey: AllowedDBKeys;
    projectId?: string;
  }): Promise<any> {
    const idbKey = this._getIDBKey(dbKey, projectId);
    // NOTE: too much clutter
    // this._store.dispatch(loadFromDb({dbKey}));
    // TODO remove legacy stuff
    return (await this._databaseService.load(idbKey)) || undefined;
  }
}
