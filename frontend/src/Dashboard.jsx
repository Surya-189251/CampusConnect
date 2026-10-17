import Portal from './Portal';
export default function View(props){return <Portal {...props} user={props.user||{role:'admin',fullName:'Account',permissions:[]}}/>;}
