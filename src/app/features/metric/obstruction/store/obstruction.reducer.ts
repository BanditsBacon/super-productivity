import {createEntityAdapter, EntityAdapter} from '@ngrx/entity';
import {ObstructionActions, ObstructionActionTypes} from './obstruction.actions';
import {Obstruction, ObstructionState} from '../obstruction.model';
import {createFeatureSelector, createSelector} from '@ngrx/store';

export const OBSTRUCTION_FEATURE_NAME = 'obstruction';


export const adapter: EntityAdapter<Obstruction> = createEntityAdapter<Obstruction>();
export const selectObstructionFeatureState = createFeatureSelector<ObstructionState>(OBSTRUCTION_FEATURE_NAME);
export const {selectIds, selectEntities, selectAll, selectTotal} = adapter.getSelectors();
export const selectAllObstructions = createSelector(selectObstructionFeatureState, selectAll);

export const initialObstructionState: ObstructionState = adapter.getInitialState({
  // additional entity state properties
});

export function obstructionReducer(
  state = initialObstructionState,
  action: ObstructionActions
): ObstructionState {
  switch (action.type) {
    case ObstructionActionTypes.AddObstruction: {
      return adapter.addOne(action.payload.obstruction, state);
    }

    case ObstructionActionTypes.UpdateObstruction: {
      return adapter.updateOne(action.payload.obstruction, state);
    }

    case ObstructionActionTypes.DeleteObstruction: {
      return adapter.removeOne(action.payload.id, state);
    }

    case ObstructionActionTypes.DeleteObstructions: {
      return adapter.removeMany(action.payload.ids, state);
    }

    case ObstructionActionTypes.LoadObstructionState:
      return {...action.payload.state};

    default: {
      return state;
    }
  }
}


