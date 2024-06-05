import {useState} from "react";
import {Navigate} from "react-router-dom";

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [redirect,setRedirect] = useState(false);
  async function register(ev) {
    ev.preventDefault();
    const response = await fetch(`${process.env.REACT_APP_API_URL}/register`, {
      method: 'POST',
      body: JSON.stringify({username,password}),
      headers: {'Content-Type':'application/json'},
    });
    if (response.status === 200) {
      alert('registration successful');
      setRedirect(true);
    } else {
      alert('registration failed');
    }
  }

  if (redirect) {
    return <Navigate to={'/login'} />
  }
  
  return (
    <form className="register" onSubmit={register}>
      <h1>register</h1>
      <input type="text"
             placeholder="username"
             value={username}
             onChange={ev => setUsername(ev.target.value)}/>
      <input type="password"
             placeholder="password"
             value={password}
             onChange={ev => setPassword(ev.target.value)}/>
      <button>register</button>
    </form>
  );
}