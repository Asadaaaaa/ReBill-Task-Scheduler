import { compose, Model, SoftDeletes } from "sutando";

class BillModel extends compose(Model, SoftDeletes) {
    table = 'bill';
    primaryKey = 'bill_id';
}

export default BillModel;